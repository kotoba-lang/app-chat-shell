// 粗大ごみ受付の「行政区プロファイル」= shibuya actor の境界 (SSoT)。
//
// 目的: 区固有値を各ファイルに散在させず 1 箇所に集約し、「渋谷区だけ」を
// 定数の偶然ではなく **境界** で担保する。将来 区を増やす場合の seam でもある
// (generic なロジック = normalize / wizard flow は区非依存に保つ)。
//
// Actor 境界 (lightweight separation, chat.etzhayyim.com 同居のまま):
//   - actorDid  : did:web:etzhayyim.com:actor:shibuya   (path-based DID。PDS への live 登録は
//                 別途 worker `sdk.did.create` が必要 — 現状は識別子の宣言のみ)
//   - nsidPrefix: ai.etzhayyim.apps.shibuya            (records/XRPC を足す際の名前空間。
//                 chat 一般 `ai.etzhayyim.apps.chat` とは分離)

export interface WardProfile {
  /** 総務省 全国地方公共団体コード相当の区コード。 */
  wardCode: string;
  /** 表示名。 */
  wardName: string;
  /** Actor 境界: path-based DID。 */
  actorDid: string;
  /** Actor 境界: records/XRPC 名前空間。 */
  nsidPrefix: string;
  /** インターネット受付フォーム URL。 */
  receptionUrl: string;
  /** 区ポータルの粗大ごみ案内ページ。 */
  portalUrl: string;
  /** 粗大ごみ受付センター電話番号。 */
  centerTel: string;
  /** 手数料の目安に関する注記。 */
  feeDisclaimer: string;
  /** 非公式である旨 (実在の行政区とは無関係。表示必須)。 */
  unofficialNotice: string;
}

export const SHIBUYA: WardProfile = {
  wardCode: "13113",
  wardName: "渋谷区",
  actorDid: "did:web:etzhayyim.com:actor:shibuya",
  nsidPrefix: "ai.etzhayyim.apps.shibuya",
  receptionUrl: "https://sodai.tokyokankyo.or.jp/Sodai/V2Main/13113/0",
  portalUrl: "https://www.city.shibuya.tokyo.jp/kurashi/gomi/kateigomi/gomi_sodai.html",
  centerTel: "03-6834-4777",
  feeDisclaimer:
    "手数料は目安です。正式な金額は渋谷区 粗大ごみ受付センター(☎ 03-6834-4777 / インターネット受付)での申込時に確定します。",
  unofficialNotice:
    "本サービスは etzhayyim.com の非公式アシスタントです（AI Agent — unofficial）。渋谷区の公式サービスではなく、渋谷区とは無関係です。実際の申込は渋谷区 粗大ごみ受付センターで行ってください。",
};

// 現在アクティブな区。区を切り替える場合はここだけ差し替える (将来の多区化の seam)。
export const WARD: WardProfile = SHIBUYA;
