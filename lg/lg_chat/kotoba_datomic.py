"""kotoba datomic XRPC client — PRIMARY write/read surface for hakken.

Wraps ``ai.etzhayyim.apps.kotoba.datomic.{transact,q,pull,pullMany,entity,datoms,
asOf,since,history,log,basisT,dbStats,ident,entid,with}``.

Wire format (snake_case per kotoba lexicon JSON, NOT camelCase):
  - All write payloads are EDN strings (see ``edn.py``).
  - ``graph`` is the kotoba graph CID (multibase CIDv1 dag-cbor sha2-256).
    Set ``KOTOBA_GRAPH`` to a human-readable label (e.g. ``kotobase-kg-v1``);
    we hash it client-side via ``graph_cid_for_label`` so the same label
    resolves to the same content-addressed graph across nodes / restarts.
  - Auth: hakken Bearer JWT (operator_auth bypass on kotoba-server) — CACAO
    not required as long as ``KOTOBA_AGENT_DID`` matches the token issuer
    AND the graph visibility is public (``KOTOBA_DEFAULT_VISIBILITY=public``).

Policy 2026-05-30:
  - Datomic is the default surface. Writes ALWAYS go through ``dm_transact``
    / ``dm_transact_entities``; reads ALWAYS through ``dm_q`` / ``dm_pull``
    / ``dm_entity`` / ``dm_datoms``.
  - SPARQL (``kotoba.kg_sparql``) is auxiliary — use only when Datalog
    cannot express the query (DESCRIBE, CONSTRUCT, property-path closures).
"""

from __future__ import annotations

import base64
import hashlib
import os
import re
from typing import Any

import httpx

from .edn import (
    chunk_tx_data,
    encode,
    encode_tx_data,
    entity_to_tx_ops,
    kw,
    tx_add,
    tx_retract,
)

KOTOBA_XRPC   = os.environ.get("KOTOBA_XRPC_URL", "https://kotoba.etzhayyim.com")
KOTOBA_BEARER = os.environ.get("KOTOBA_BEARER", "")


# ── Graph CID derivation ──────────────────────────────────────────────────────
# kotoba's Datomic API requires ``graph`` to be a real CIDv1 multibase string,
# not a human-readable label.  Hash the label client-side so the same label
# always resolves to the same content-addressed graph.

def kotoba_cid(payload: bytes) -> str:
    digest = hashlib.sha256(payload).digest()
    cid    = bytes((0x01, 0x71, 0x12, 0x20)) + digest
    return "b" + base64.b32encode(cid).rstrip(b"=").decode("ascii").lower()


def graph_cid_for_label(label: str) -> str:
    """Stable kotoba graph CID derived from a human-readable label."""
    # If the caller already gave us a multibase CID, pass through unchanged.
    if label.startswith("b") and re.fullmatch(r"b[a-z2-7]{58,80}", label):
        return label
    return kotoba_cid(label.encode("utf-8"))


_GRAPH_LABEL = os.environ.get("KOTOBA_GRAPH", "kotobase-kg-v1")
DEFAULT_GRAPH = graph_cid_for_label(_GRAPH_LABEL)


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {KOTOBA_BEARER}"} if KOTOBA_BEARER else {}


# ── EDN row value decode (server returns rows_edn as list[list[str]]) ────────

_INT_RE   = re.compile(r"^-?\d+$")
_FLOAT_RE = re.compile(r"^-?\d+\.\d+([eE][+-]?\d+)?$")


def parse_edn_value(s: str) -> Any:
    if s.startswith('"') and s.endswith('"'):
        body = s[1:-1]
        return body.replace('\\"', '"').replace("\\\\", "\\")
    if s == "true":  return True
    if s == "false": return False
    if s == "nil":   return None
    if _INT_RE.match(s):   return int(s)
    if _FLOAT_RE.match(s): return float(s)
    return s


# ── Writes ────────────────────────────────────────────────────────────────────

async def dm_transact(
    client: httpx.AsyncClient,
    tx_edn: str,
    *,
    graph:           str        = DEFAULT_GRAPH,
    expected_parent: str | None = None,
    cacao_b64:       str | None = None,
) -> dict[str, Any]:
    """POST ``datomic.transact``.

    Returns ``{status, tx_cid, commit_cid, index_roots, datom_count,
    tempids, datoms, ...}``.  The lineage anchor is ``commit_cid`` (use as
    ``expected_parent`` for the next chunk).
    """
    body: dict[str, Any] = {"graph": graph, "tx_edn": tx_edn}
    if expected_parent: body["expected_parent"] = expected_parent
    if cacao_b64:       body["cacao_b64"]       = cacao_b64
    resp = await client.post(
        f"{KOTOBA_XRPC}/xrpc/ai.etzhayyim.apps.kotoba.datomic.transact",
        headers=_headers(),
        json=body,
    )
    resp.raise_for_status()
    return resp.json()


async def dm_transact_entities(
    client:   httpx.AsyncClient,
    entities: list[dict],
    *,
    graph: str = DEFAULT_GRAPH,
) -> list[dict[str, Any]]:
    """Batch ingest hakken-style entities, splitting into <1 MiB EDN chunks.

    Returns the list of per-chunk transact responses (each carries
    ``tx_cid`` + ``commit_cid``).  Chunks are chained via
    ``expected_parent`` so the whole batch lands on one lineage.
    """
    all_ops: list[list[Any]] = []
    for e in entities:
        all_ops.extend(entity_to_tx_ops(e))
    chunks  = chunk_tx_data(all_ops)
    results: list[dict[str, Any]] = []
    parent: str | None = None
    for c in chunks:
        r = await dm_transact(client, c, graph=graph, expected_parent=parent)
        results.append(r)
        parent = r.get("commit_cid") or parent
    return results


async def dm_retract(
    client:    httpx.AsyncClient,
    entity_id: str,
    attr:      str,
    value:     Any,
    *,
    graph: str = DEFAULT_GRAPH,
) -> dict[str, Any]:
    """Retract a single ``[E A V]`` datom via ``datomic.transact``."""
    return await dm_transact(
        client,
        encode_tx_data([tx_retract(entity_id, attr, value)]),
        graph=graph,
    )


# ── Reads ─────────────────────────────────────────────────────────────────────

async def dm_q(
    client:    httpx.AsyncClient,
    query_edn: str,
    inputs:    list[Any] | None = None,
    *,
    graph:   str  = DEFAULT_GRAPH,
    as_of:   str | None = None,
    since:   str | None = None,
    history: bool = False,
) -> list[list[Any]]:
    """POST ``datomic.q`` (Datalog).

    Server returns ``rows_edn: list[list[str]]`` where each scalar is an
    EDN-encoded string.  We decode each scalar to a Python value before
    returning so callers can pattern-match on ints / bools / strings
    directly.
    """
    body: dict[str, Any] = {"graph": graph, "query_edn": query_edn}
    if inputs:  body["inputs_edn"] = [encode(v) for v in inputs]
    if as_of:   body["as_of"]      = as_of
    if since:   body["since"]      = since
    if history: body["history"]    = True
    resp = await client.post(
        f"{KOTOBA_XRPC}/xrpc/ai.etzhayyim.apps.kotoba.datomic.q",
        headers=_headers(),
        json=body,
    )
    resp.raise_for_status()
    rows = resp.json().get("rows_edn", []) or []
    return [[parse_edn_value(c) for c in row] for row in rows]


async def dm_pull(
    client:      httpx.AsyncClient,
    entity:      str,
    pattern_edn: str | None = None,
    *,
    graph: str        = DEFAULT_GRAPH,
    as_of: str | None = None,
) -> dict[str, Any] | None:
    """POST ``datomic.pull``.

    Returns the full pull response (``{entity, entity_edn, datom_count,
    datoms}``) or ``None`` on 404.
    """
    body: dict[str, Any] = {"graph": graph, "entity": entity}
    if pattern_edn: body["pattern_edn"] = pattern_edn
    if as_of:       body["as_of"]       = as_of
    resp = await client.post(
        f"{KOTOBA_XRPC}/xrpc/ai.etzhayyim.apps.kotoba.datomic.pull",
        headers=_headers(),
        json=body,
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


async def dm_pull_many(
    client:      httpx.AsyncClient,
    entities:    list[str],
    pattern_edn: str | None = None,
    *,
    graph: str = DEFAULT_GRAPH,
) -> list[dict[str, Any]]:
    body: dict[str, Any] = {"graph": graph, "entities": entities}
    if pattern_edn: body["pattern_edn"] = pattern_edn
    resp = await client.post(
        f"{KOTOBA_XRPC}/xrpc/ai.etzhayyim.apps.kotoba.datomic.pullMany",
        headers=_headers(),
        json=body,
    )
    resp.raise_for_status()
    return resp.json().get("entities", [])


async def dm_entity(
    client: httpx.AsyncClient,
    entity: str,
    *,
    graph: str        = DEFAULT_GRAPH,
    as_of: str | None = None,
) -> dict[str, Any] | None:
    """POST ``datomic.entity``. Returns the full E-AV map."""
    body: dict[str, Any] = {"graph": graph, "entity": entity}
    if as_of: body["as_of"] = as_of
    resp = await client.post(
        f"{KOTOBA_XRPC}/xrpc/ai.etzhayyim.apps.kotoba.datomic.entity",
        headers=_headers(),
        json=body,
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json().get("entity")


async def dm_datoms(
    client:         httpx.AsyncClient,
    index:          str,
    components_edn: list[str] | None = None,
    *,
    graph: str        = DEFAULT_GRAPH,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """POST ``datomic.datoms``. ``index`` ∈ ``{:eavt, :aevt, :avet, :vaet}``."""
    body: dict[str, Any] = {"graph": graph, "index": index}
    if components_edn: body["components_edn"] = components_edn
    if limit:          body["limit"]          = limit
    resp = await client.post(
        f"{KOTOBA_XRPC}/xrpc/ai.etzhayyim.apps.kotoba.datomic.datoms",
        headers=_headers(),
        json=body,
    )
    resp.raise_for_status()
    return resp.json().get("datoms", [])


async def dm_log(
    client: httpx.AsyncClient,
    *,
    graph: str        = DEFAULT_GRAPH,
    start: str | None = None,
    end:   str | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    body: dict[str, Any] = {"graph": graph}
    if start: body["start"] = start
    if end:   body["end"]   = end
    if limit: body["limit"] = limit
    resp = await client.post(
        f"{KOTOBA_XRPC}/xrpc/ai.etzhayyim.apps.kotoba.datomic.log",
        headers=_headers(),
        json=body,
    )
    resp.raise_for_status()
    return resp.json().get("entries", [])


async def dm_basis_t(
    client: httpx.AsyncClient,
    *,
    graph: str = DEFAULT_GRAPH,
) -> str | None:
    resp = await client.post(
        f"{KOTOBA_XRPC}/xrpc/ai.etzhayyim.apps.kotoba.datomic.basisT",
        headers=_headers(),
        json={"graph": graph},
    )
    resp.raise_for_status()
    return resp.json().get("basis_t")


async def dm_db_stats(
    client: httpx.AsyncClient,
    *,
    graph: str = DEFAULT_GRAPH,
) -> dict[str, Any]:
    resp = await client.post(
        f"{KOTOBA_XRPC}/xrpc/ai.etzhayyim.apps.kotoba.datomic.dbStats",
        headers=_headers(),
        json={"graph": graph},
    )
    resp.raise_for_status()
    return resp.json()


__all__ = [
    "DEFAULT_GRAPH", "KOTOBA_XRPC", "graph_cid_for_label", "kotoba_cid",
    "parse_edn_value",
    "dm_transact", "dm_transact_entities", "dm_retract",
    "dm_q", "dm_pull", "dm_pull_many", "dm_entity", "dm_datoms",
    "dm_log", "dm_basis_t", "dm_db_stats",
    # re-export EDN builders for caller convenience
    "encode", "encode_tx_data", "tx_add", "tx_retract", "kw",
]
