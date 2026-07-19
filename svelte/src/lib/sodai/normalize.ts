// 渋谷区 粗大ごみインターネット受付 (東京都環境公社 粗大ごみ受付センター /
// sodai.tokyokankyo.or.jp) の入力フォームは、フィールドごとに文字種を厳格に
// 検証する (フリガナ=全角カタカナ / 電話=半角数字 / メール=半角英数記号 ...)。
// 全角・半角・大文字小文字の取り違えで弾かれる事故が多い。
//
// このモジュールは「フィールドごとに目標の文字種 (convention) を宣言し、
// 入力を決定論的に正規化し、変換前→変換後を返す」純粋関数群。LLM は一切使わない
// (正規化を確率モデルに委ねない)。実フォームの仕様が SPA でスクレイプ不能のため、
// 東京都粗大ごみ受付フォームの標準規約をデフォルトとし、各フィールドは方向を
// 明示・上書きできる。UI 側で before→after を必ず提示し、方向ミスを利用者が
// 検知できるようにする。

// ─────────────────────────────────────────────────────────────────────────
// 1. 低レベル文字変換 (いずれも純粋・冪等)
// ─────────────────────────────────────────────────────────────────────────

const FULLWIDTH_ASCII_START = 0xff01; // ！
const FULLWIDTH_ASCII_END = 0xff5e; // ～
const ASCII_OFFSET = 0xfee0; // 全角ASCII − 半角ASCII

/** 全角ASCII (！-～) と全角スペース(U+3000) を半角へ。 */
export function toHankakuAscii(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= FULLWIDTH_ASCII_START && code <= FULLWIDTH_ASCII_END) {
      out += String.fromCodePoint(code - ASCII_OFFSET);
    } else if (code === 0x3000) {
      out += " ";
    } else {
      out += ch;
    }
  }
  return out;
}

/** 半角ASCII (!-~) と半角スペースを全角へ。 */
export function toZenkakuAscii(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x21 && code <= 0x7e) {
      out += String.fromCodePoint(code + ASCII_OFFSET);
    } else if (code === 0x20) {
      out += "　";
    } else {
      out += ch;
    }
  }
  return out;
}

/** 全角数字 (０-９) → 半角数字 (0-9)。他の全角文字には触れない。 */
export function toHankakuDigits(input: string): string {
  return input.replace(/[０-９]/g, (ch) =>
    String.fromCodePoint(ch.codePointAt(0)! - ASCII_OFFSET),
  );
}

/** 半角数字 (0-9) → 全角数字 (０-９)。 */
export function toZenkakuDigits(input: string): string {
  return input.replace(/[0-9]/g, (ch) =>
    String.fromCodePoint(ch.codePointAt(0)! + ASCII_OFFSET),
  );
}

/** ひらがな (ぁ-ゖ) → カタカナ (ァ-ヶ)。 */
export function hiraganaToKatakana(input: string): string {
  return input.replace(/[ぁ-ゖ]/g, (ch) =>
    String.fromCodePoint(ch.codePointAt(0)! + 0x60),
  );
}

// 半角カタカナ → 全角カタカナ。濁点・半濁点は前の文字と合成する。
const HANKAKU_KATAKANA_BASE: Record<string, string> = {
  "｡": "。", "｢": "「", "｣": "」", "､": "、", "･": "・", "ｰ": "ー",
  "ｦ": "ヲ", "ｧ": "ァ", "ｨ": "ィ", "ｩ": "ゥ", "ｪ": "ェ", "ｫ": "ォ",
  "ｬ": "ャ", "ｭ": "ュ", "ｮ": "ョ", "ｯ": "ッ",
  "ｱ": "ア", "ｲ": "イ", "ｳ": "ウ", "ｴ": "エ", "ｵ": "オ",
  "ｶ": "カ", "ｷ": "キ", "ｸ": "ク", "ｹ": "ケ", "ｺ": "コ",
  "ｻ": "サ", "ｼ": "シ", "ｽ": "ス", "ｾ": "セ", "ｿ": "ソ",
  "ﾀ": "タ", "ﾁ": "チ", "ﾂ": "ツ", "ﾃ": "テ", "ﾄ": "ト",
  "ﾅ": "ナ", "ﾆ": "ニ", "ﾇ": "ヌ", "ﾈ": "ネ", "ﾉ": "ノ",
  "ﾊ": "ハ", "ﾋ": "ヒ", "ﾌ": "フ", "ﾍ": "ヘ", "ﾎ": "ホ",
  "ﾏ": "マ", "ﾐ": "ミ", "ﾑ": "ム", "ﾒ": "メ", "ﾓ": "モ",
  "ﾔ": "ヤ", "ﾕ": "ユ", "ﾖ": "ヨ",
  "ﾗ": "ラ", "ﾘ": "リ", "ﾙ": "ル", "ﾚ": "レ", "ﾛ": "ロ",
  "ﾜ": "ワ", "ﾝ": "ン",
};

const HANKAKU_KATAKANA_DAKUTEN: Record<string, string> = {
  "ｶ": "ガ", "ｷ": "ギ", "ｸ": "グ", "ｹ": "ゲ", "ｺ": "ゴ",
  "ｻ": "ザ", "ｼ": "ジ", "ｽ": "ズ", "ｾ": "ゼ", "ｿ": "ゾ",
  "ﾀ": "ダ", "ﾁ": "ヂ", "ﾂ": "ヅ", "ﾃ": "デ", "ﾄ": "ド",
  "ﾊ": "バ", "ﾋ": "ビ", "ﾌ": "ブ", "ﾍ": "ベ", "ﾎ": "ボ",
  "ｳ": "ヴ", "ﾜ": "ヷ", "ｦ": "ヺ",
};

const HANKAKU_KATAKANA_HANDAKUTEN: Record<string, string> = {
  "ﾊ": "パ", "ﾋ": "ピ", "ﾌ": "プ", "ﾍ": "ペ", "ﾎ": "ポ",
};

/** 半角カタカナ (ｱ ｶﾞ ﾊﾟ ...) → 全角カタカナ (ア ガ パ ...)。 */
export function hankakuKatakanaToZenkaku(input: string): string {
  const chars = [...input];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (next === "ﾞ" && HANKAKU_KATAKANA_DAKUTEN[ch]) {
      out += HANKAKU_KATAKANA_DAKUTEN[ch];
      i++;
    } else if (next === "ﾟ" && HANKAKU_KATAKANA_HANDAKUTEN[ch]) {
      out += HANKAKU_KATAKANA_HANDAKUTEN[ch];
      i++;
    } else if (HANKAKU_KATAKANA_BASE[ch]) {
      out += HANKAKU_KATAKANA_BASE[ch];
    } else if (ch === "ﾞ") {
      out += "゛";
    } else if (ch === "ﾟ") {
      out += "゜";
    } else {
      out += ch;
    }
  }
  return out;
}

/** あらゆるカナ表記を全角カタカナへ寄せる (ひらがな + 半角カナ + 全角カナ)。 */
export function toZenkakuKatakana(input: string): string {
  return hiraganaToKatakana(hankakuKatakanaToZenkaku(input));
}

/** 前後の空白 (半角/全角) を除去。 */
export function trimSpaces(input: string): string {
  return input.replace(/^[\s　]+/, "").replace(/[\s　]+$/, "");
}

// ─────────────────────────────────────────────────────────────────────────
// 2. フィールド別 convention
// ─────────────────────────────────────────────────────────────────────────

export type Convention =
  | "zenkaku" // 全角テキスト (氏名・住所・建物名)
  | "zenkakuKatakana" // 全角カタカナ (フリガナ)
  | "hankakuDigits" // 半角数字のみ
  | "hankakuPhone" // 半角数字 + ハイフン (電話)
  | "hankakuPostal" // NNN-NNNN 半角 (郵便番号)
  | "hankakuAscii"; // 半角英数記号 (メールアドレス)

export interface NormalizeResult {
  /** 正規化後の値。 */
  value: string;
  /** 入力から実際に変化したか (before→after 表示の判定用)。 */
  changed: boolean;
  /** 正規化後も convention に合わない残留文字がある場合の警告。 */
  warnings: string[];
}

const ALLOWED_FULLWIDTH_KATAKANA = /^[ァ-ヶー　\s゛゜・]*$/;

/**
 * フィールドを正規化する。各 convention は「目標文字種」を表す。
 * - zenkaku        : 半角ASCII/空白 → 全角。漢字・ひらがな・カナはそのまま。
 * - zenkakuKatakana: ひらがな/半角カナ → 全角カタカナ。残ったローマ字等は警告。
 * - hankakuDigits  : 全角数字 → 半角。数字以外は除去。
 * - hankakuPhone   : 全角→半角数字、区切りはハイフンに統一。
 * - hankakuPostal  : 半角7桁を NNN-NNNN に整形。
 * - hankakuAscii   : 全角英数記号 → 半角、空白除去 (メール)。
 */
export function normalizeField(
  raw: string,
  convention: Convention,
): NormalizeResult {
  const input = raw ?? "";
  const warnings: string[] = [];
  let value: string;

  switch (convention) {
    case "zenkaku": {
      // 住所・氏名: 半角英数記号と半角空白を全角へ。内部の連続空白は全角1個に。
      value = toZenkakuAscii(trimSpaces(input)).replace(/　+/g, "　");
      break;
    }

    case "zenkakuKatakana": {
      value = trimSpaces(toZenkakuKatakana(input));
      // 全角カタカナ・長音・中黒・空白以外が残っていれば警告 (ローマ字混入など)。
      const residual = value.replace(/[ァ-ヶー　\s゛゜・]/g, "");
      if (residual.length > 0) {
        warnings.push(
          `フリガナに全角カタカナ以外の文字が残っています: 「${residual}」。カタカナで入力してください。`,
        );
      }
      break;
    }

    case "hankakuDigits": {
      value = toHankakuDigits(input).replace(/[^0-9]/g, "");
      break;
    }

    case "hankakuPhone": {
      // 全角→半角数字。括弧・スペース・全角ハイフン類はすべて半角ハイフンへ。
      const half = toHankakuAscii(toHankakuDigits(input));
      const digits = half.replace(/[^0-9]/g, "");
      value = digits;
      if (digits.length < 10 || digits.length > 11) {
        warnings.push(
          `電話番号の桁数が${digits.length}桁です。市外局番を含む10〜11桁の半角数字で入力してください。`,
        );
      }
      break;
    }

    case "hankakuPostal": {
      const digits = toHankakuDigits(input).replace(/[^0-9]/g, "");
      if (digits.length === 7) {
        value = `${digits.slice(0, 3)}-${digits.slice(3)}`;
      } else {
        value = digits;
        warnings.push(
          `郵便番号は7桁です (現在${digits.length}桁)。例: 150-8010`,
        );
      }
      break;
    }

    case "hankakuAscii": {
      // メール: 全角英数記号→半角、空白は誤入力なので除去。大文字小文字は保持。
      value = toHankakuAscii(input).replace(/[\s　]/g, "");
      // 全角文字が残っていれば警告。
      // eslint-disable-next-line no-control-regex
      const nonAscii = value.replace(/[\x21-\x7e]/g, "");
      if (nonAscii.length > 0) {
        warnings.push(
          `メールアドレスに半角英数記号以外が含まれています: 「${nonAscii}」`,
        );
      }
      break;
    }

    default: {
      value = input;
    }
  }

  return { value, changed: value !== input, warnings };
}

/** convention の人間可読ラベル (UI のヒント表示用)。 */
export const CONVENTION_LABEL: Record<Convention, string> = {
  zenkaku: "全角",
  zenkakuKatakana: "全角カタカナ",
  hankakuDigits: "半角数字",
  hankakuPhone: "半角数字（ハイフン除く）",
  hankakuPostal: "半角数字 NNN-NNNN",
  hankakuAscii: "半角英数記号",
};

/** 全角カタカナのみかどうか (フリガナ確定前の最終チェック用)。 */
export function isFullwidthKatakana(value: string): boolean {
  return ALLOWED_FULLWIDTH_KATAKANA.test(value);
}
