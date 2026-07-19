"""Minimal Python → EDN encoder for kotoba datomic transactions.

Targets the subset kotoba-server `kotoba_edn::parse` understands for
`datomic.transact` tx-data: list of `[:db/add E A V]` / `[:db/retract E A V]`
vectors and entity maps.

Strings are escaped per EDN spec (\\, \", \n, \r, \t). All other chars pass
through; assume hakken payloads are valid UTF-8 text.
"""

from __future__ import annotations

from typing import Any, Iterable


class EdnSymbol(str):
    """Bare EDN symbol or keyword (no quoting). Example: EdnSymbol(':db/add')."""


def kw(name: str) -> EdnSymbol:
    """Keyword shortcut: kw('phase') → :phase, kw('db/add') → :db/add."""
    return EdnSymbol(name if name.startswith(":") else f":{name}")


def encode(value: Any) -> str:
    if isinstance(value, EdnSymbol):
        return str(value)
    if value is None:
        return "nil"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, str):
        return _encode_str(value)
    if isinstance(value, (list, tuple)):
        return "[" + " ".join(encode(v) for v in value) + "]"
    if isinstance(value, set):
        return "#{" + " ".join(encode(v) for v in value) + "}"
    if isinstance(value, dict):
        parts = []
        for k, v in value.items():
            parts.append(encode(kw(k) if isinstance(k, str) and not isinstance(k, EdnSymbol) else k))
            parts.append(encode(v))
        return "{" + " ".join(parts) + "}"
    raise TypeError(f"unsupported EDN value: {type(value).__name__}")


def _encode_str(s: str) -> str:
    out = ['"']
    for ch in s:
        if ch == "\\":
            out.append("\\\\")
        elif ch == '"':
            out.append('\\"')
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def tx_add(e: str, a: str, v: Any) -> list[Any]:
    """`[:db/add <e> <a> <v>]` tx op."""
    return [kw("db/add"), e, kw(a) if not a.startswith(":") else EdnSymbol(a), v]


def tx_retract(e: str, a: str, v: Any) -> list[Any]:
    """`[:db/retract <e> <a> <v>]` tx op."""
    return [kw("db/retract"), e, kw(a) if not a.startswith(":") else EdnSymbol(a), v]


def encode_tx_data(ops: Iterable[list[Any]]) -> str:
    """Encode a sequence of tx-ops as a single EDN vector string."""
    return "[" + " ".join(encode(op) for op in ops) + "]"


def chunk_tx_data(ops: list[list[Any]], max_bytes: int = 900_000) -> list[str]:
    """Split tx-ops into EDN-encoded chunks each under `max_bytes`.

    kotoba-server caps `tx_edn` at 1 MiB; default 900_000 leaves headroom.
    """
    chunks: list[str] = []
    cur: list[list[Any]] = []
    cur_size = 2  # [ ]
    for op in ops:
        s = encode(op)
        op_size = len(s.encode("utf-8")) + 1  # + space
        if cur and cur_size + op_size > max_bytes:
            chunks.append(encode_tx_data(cur))
            cur = []
            cur_size = 2
        cur.append(op)
        cur_size += op_size
    if cur:
        chunks.append(encode_tx_data(cur))
    return chunks


def entity_to_tx_ops(entity: dict, *, ident_attr: str = "kg/id") -> list[list[Any]]:
    """Convert a hakken-style entity dict to a list of `:db/add` tx-ops.

    Schema:
      {id, type?, labelJa?, labelEn?, claims:[{pred,value}], relations:[{pred,dstId}]}

    Output uses the entity's `id` as the EDN entity ref (caller-stable string).
    Predicates are prefixed with `kg/claim/` for claims and `kg/relation/` for
    relations to match kotoba-server's KG predicate convention.
    """
    eid = entity["id"]
    ops: list[list[Any]] = [tx_add(eid, ident_attr, eid)]
    if "type" in entity:
        ops.append(tx_add(eid, "kg/type", entity["type"]))
    if "labelJa" in entity:
        ops.append(tx_add(eid, "kg/labelJa", entity["labelJa"]))
    if "labelEn" in entity:
        ops.append(tx_add(eid, "kg/labelEn", entity["labelEn"]))
    for c in entity.get("claims", []):
        ops.append(tx_add(eid, f"kg/claim/{c['pred']}", c["value"]))
    for r in entity.get("relations", []):
        ops.append(tx_add(eid, f"kg/relation/{r['pred']}", r["dstId"]))
    return ops
