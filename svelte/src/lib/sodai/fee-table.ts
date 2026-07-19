// 渋谷区 粗大ごみ 代表品目カタログ + 手数料(目安)。
//
// ⚠️ 手数料は「目安」。正式金額は申込時に粗大ごみ受付センターが確定する。
// 出典: 渋谷区「粗大ごみ処理手数料一覧」+ 粗大ごみ受付センター(03-6834-4777 /
// インターネット24時間)。金額改定があり得るため、ここは単一SSoTとして編集する。
//
// LLM は使わず、自由文 → 品目のマッチングはクライアント側のキーワード照合で行う
// (決定論的・オフラインでも動く)。LLM 補助は別レイヤ(llm.ts)で任意に上乗せする。
//
// 注: この品目カタログは WARD (現=渋谷区) のデータ。区固有のスカラ値 (TEL/URL/区名/
// ディスクレーマ) は ward.ts に集約済み。多区化する場合はカタログも区プロファイル側へ。
import { WARD } from "./ward";

export const FEE_DISCLAIMER = WARD.feeDisclaimer;

export interface SodaiItem {
  /** 安定ID (申請内容の参照キー)。 */
  id: string;
  /** 公式一覧に準じた品目名。 */
  name: string;
  /** 手数料の目安 (円)。 */
  feeYen: number;
  /** 分類 (UI のグルーピング用)。 */
  category: "家具" | "寝具" | "家電" | "自転車・乗物" | "趣味・スポーツ" | "その他";
  /** 自由文マッチ用キーワード (ひらがな/カタカナ/漢字/略称)。 */
  keywords: string[];
  /** 補足 (サイズ条件など)。 */
  note?: string;
}

export const SODAI_CATALOG: SodaiItem[] = [
  // ── 家具 ──────────────────────────────────────────────
  { id: "chair", name: "椅子（事務用・ダイニング）", feeYen: 400, category: "家具", keywords: ["いす", "イス", "椅子", "チェア", "ダイニングチェア"] },
  { id: "zaisu", name: "座椅子", feeYen: 400, category: "家具", keywords: ["ざいす", "座椅子", "ザイス"] },
  { id: "sofa1", name: "ソファー（1人用）", feeYen: 800, category: "家具", keywords: ["そふぁ", "ソファ", "ソファー", "1人掛け", "一人掛け", "1人用"] },
  { id: "sofa2", name: "ソファー（2人以上用）", feeYen: 2000, category: "家具", keywords: ["そふぁ", "ソファ", "ソファー", "2人掛け", "二人掛け", "3人掛け", "2人以上"] },
  { id: "table", name: "テーブル（食卓・座卓）", feeYen: 800, category: "家具", keywords: ["てーぶる", "テーブル", "食卓", "座卓", "ローテーブル"] },
  { id: "kotatsu", name: "こたつ（本体）", feeYen: 800, category: "家具", keywords: ["こたつ", "コタツ", "炬燵"] },
  { id: "desk", name: "机（学習机・事務机）", feeYen: 1200, category: "家具", keywords: ["つくえ", "机", "デスク", "学習机", "事務机"] },
  { id: "tansu_s", name: "タンス（高さ1m未満）", feeYen: 800, category: "家具", keywords: ["たんす", "タンス", "箪笥", "チェスト", "整理ダンス"], note: "高さ1m未満" },
  { id: "tansu_m", name: "タンス（高さ1m以上2m未満）", feeYen: 1200, category: "家具", keywords: ["たんす", "タンス", "箪笥", "チェスト"], note: "高さ1〜2m" },
  { id: "tansu_l", name: "タンス（高さ2m以上）", feeYen: 2000, category: "家具", keywords: ["たんす", "タンス", "箪笥", "大型タンス"], note: "高さ2m以上" },
  { id: "shelf", name: "本棚・ラック", feeYen: 800, category: "家具", keywords: ["ほんだな", "本棚", "ラック", "シェルフ", "棚"] },
  { id: "kitchen_shelf", name: "食器棚", feeYen: 1200, category: "家具", keywords: ["しょっきだな", "食器棚", "カップボード"] },
  { id: "getabako", name: "下駄箱・シューズボックス", feeYen: 800, category: "家具", keywords: ["げたばこ", "下駄箱", "靴箱", "シューズボックス"] },
  { id: "case", name: "衣装ケース", feeYen: 400, category: "家具", keywords: ["いしょうけーす", "衣装ケース", "収納ケース", "プラスチックケース"] },
  { id: "mirror", name: "姿見・鏡（大型）", feeYen: 400, category: "家具", keywords: ["すがたみ", "姿見", "鏡", "ミラー"] },

  // ── 寝具 ──────────────────────────────────────────────
  { id: "bed", name: "ベッド（マットレス除く）", feeYen: 1200, category: "寝具", keywords: ["べっど", "ベッド", "ベットフレーム"] },
  { id: "mattress_spring", name: "マットレス（スプリング入り）", feeYen: 1200, category: "寝具", keywords: ["まっとれす", "マットレス", "スプリング"] },
  { id: "mattress_nospring", name: "マットレス（スプリングなし）", feeYen: 400, category: "寝具", keywords: ["まっとれす", "マットレス", "ウレタン"] },
  { id: "futon", name: "布団（1組）", feeYen: 400, category: "寝具", keywords: ["ふとん", "布団", "ふとん", "掛け布団", "敷き布団"] },
  { id: "carpet", name: "カーペット・じゅうたん", feeYen: 400, category: "寝具", keywords: ["かーぺっと", "カーペット", "じゅうたん", "絨毯", "ラグ"], note: "6畳以上は800円" },

  // ── 家電（リサイクル法対象外） ─────────────────────────
  { id: "microwave", name: "電子レンジ", feeYen: 400, category: "家電", keywords: ["でんしれんじ", "電子レンジ", "レンジ", "オーブンレンジ"] },
  { id: "fan", name: "扇風機", feeYen: 400, category: "家電", keywords: ["せんぷうき", "扇風機", "サーキュレーター"] },
  { id: "vacuum", name: "掃除機", feeYen: 400, category: "家電", keywords: ["そうじき", "掃除機", "クリーナー"] },
  { id: "heater", name: "ストーブ・ファンヒーター", feeYen: 400, category: "家電", keywords: ["すとーぶ", "ストーブ", "ヒーター", "ファンヒーター", "石油ストーブ"] },
  { id: "ricecooker", name: "炊飯器", feeYen: 400, category: "家電", keywords: ["すいはんき", "炊飯器", "炊飯ジャー"] },
  { id: "humidifier", name: "加湿器・除湿機", feeYen: 400, category: "家電", keywords: ["かしつき", "加湿器", "除湿機", "じょしつき"] },

  // ── 自転車・乗物 ──────────────────────────────────────
  { id: "bicycle", name: "自転車（16インチ以上）", feeYen: 800, category: "自転車・乗物", keywords: ["じてんしゃ", "自転車", "ママチャリ", "クロスバイク"] },
  { id: "bicycle_kids", name: "自転車（16インチ未満・子供用）", feeYen: 400, category: "自転車・乗物", keywords: ["じてんしゃ", "子供用自転車", "幼児用自転車"] },
  { id: "stroller", name: "ベビーカー", feeYen: 400, category: "自転車・乗物", keywords: ["べびーかー", "ベビーカー", "バギー"] },
  { id: "childseat", name: "チャイルドシート", feeYen: 400, category: "自転車・乗物", keywords: ["ちゃいるどしーと", "チャイルドシート", "ジュニアシート"] },

  // ── 趣味・スポーツ ────────────────────────────────────
  { id: "golf", name: "ゴルフバッグ（クラブ含む）", feeYen: 400, category: "趣味・スポーツ", keywords: ["ごるふ", "ゴルフ", "ゴルフバッグ", "クラブ"] },
  { id: "ski", name: "スキー板・スノーボード", feeYen: 400, category: "趣味・スポーツ", keywords: ["すきー", "スキー", "スノーボード", "スノボ", "板"] },
  { id: "guitar", name: "ギター", feeYen: 400, category: "趣味・スポーツ", keywords: ["ぎたー", "ギター", "アコギ", "エレキ"] },

  // ── その他 ────────────────────────────────────────────
  { id: "monohoshi", name: "物干し台（コンクリート台除く）", feeYen: 400, category: "その他", keywords: ["ものほし", "物干し", "物干し台", "物干し竿", "ものほしざお"] },
  { id: "suitcase", name: "スーツケース・キャリーケース", feeYen: 400, category: "その他", keywords: ["すーつけーす", "スーツケース", "キャリーケース", "キャリーバッグ", "トランク"] },
  { id: "sudare", name: "すだれ・よしず", feeYen: 400, category: "その他", keywords: ["すだれ", "よしず", "簾"] },
];

// 家電リサイクル法・小型家電リサイクル法の対象は粗大ごみとして「収集できない」。
// 申込前に検知して案内する (誤申請の防止)。
export interface NonAcceptedHint {
  match: string[];
  label: string;
  guidance: string;
}

export const NON_ACCEPTED: NonAcceptedHint[] = [
  {
    match: ["テレビ", "てれび", "TV", "液晶テレビ", "ブラウン管"],
    label: "テレビ",
    guidance: "家電リサイクル法の対象です。購入店・買替先またはメーカー回収へ。粗大ごみでは収集できません。",
  },
  {
    match: ["冷蔵庫", "れいぞうこ", "冷凍庫", "れいとうこ"],
    label: "冷蔵庫・冷凍庫",
    guidance: "家電リサイクル法の対象です。購入店・買替先またはメーカー回収へ。",
  },
  {
    match: ["洗濯機", "せんたくき", "衣類乾燥機", "乾燥機"],
    label: "洗濯機・衣類乾燥機",
    guidance: "家電リサイクル法の対象です。購入店・買替先へ。",
  },
  {
    match: ["エアコン", "えあこん", "クーラー"],
    label: "エアコン",
    guidance: "家電リサイクル法の対象です。設置・購入店へ。",
  },
  {
    match: ["パソコン", "ぱそこん", "PC", "ノートパソコン", "デスクトップ"],
    label: "パソコン",
    guidance: "小型家電リサイクル法/メーカー回収(PCリサイクル)の対象です。粗大ごみでは収集できません。",
  },
];

export interface MatchResult {
  /** カタログ品目の候補 (スコア降順)。 */
  candidates: SodaiItem[];
  /** 収集対象外として検知された場合のヒント。 */
  nonAccepted?: NonAcceptedHint;
}

/**
 * 自由文から品目候補を返す (決定論的キーワード照合)。
 * 例: 「二人がけの古いソファー」→ ソファー(2人以上用) 等。
 */
export function matchItems(freeText: string): MatchResult {
  const text = freeText.trim();
  if (!text) return { candidates: [] };

  // まず収集対象外を検知。
  for (const hint of NON_ACCEPTED) {
    if (hint.match.some((m) => text.includes(m))) {
      return { candidates: [], nonAccepted: hint };
    }
  }

  const scored = SODAI_CATALOG.map((item) => {
    let score = 0;
    for (const kw of item.keywords) {
      if (text.includes(kw)) score += kw.length; // 長い一致ほど高スコア
    }
    // サイズ語のヒント加点 (1人/2人, 高さ等)。
    if (item.note) {
      for (const token of item.note.replace(/[^0-9a-zA-Zぁ-んァ-ヶ一-龠m]/g, " ").split(" ")) {
        if (token && text.includes(token)) score += 1;
      }
    }
    return { item, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return { candidates: scored.map((s) => s.item) };
}

/** 申請明細から合計手数料(目安)を算出。 */
export function totalFee(lines: { item: SodaiItem; qty: number }[]): number {
  return lines.reduce((sum, l) => sum + l.item.feeYen * l.qty, 0);
}
