// 申込者情報フィールドの宣言。各フィールドが「目標の文字種(convention)」を持ち、
// SodaiWizard はこの順に質問していく。正規化方向はここが単一の宣言点 — 実フォームの
// 仕様が違っていた場合もここを直せば全体に反映され、UI が before→after を必ず提示する。
import type { Convention } from "./normalize";

export interface FieldDef {
  key: string;
  label: string;
  /** チャットでの質問文。 */
  prompt: string;
  convention: Convention;
  required: boolean;
  placeholder: string;
  /** 入力例 (ヒント表示)。 */
  example: string;
}

export const APPLICANT_FIELDS: FieldDef[] = [
  {
    key: "name",
    label: "氏名",
    prompt: "申込者の氏名を入力してください。",
    convention: "zenkaku",
    required: true,
    placeholder: "渋谷　太郎",
    example: "渋谷　太郎（全角、姓名の間は全角スペース）",
  },
  {
    key: "nameKana",
    label: "フリガナ",
    prompt:
      "氏名のフリガナを入力してください。ひらがな・半角カナで入力しても、自動で全角カタカナに直します。",
    convention: "zenkakuKatakana",
    required: true,
    placeholder: "シブヤ　タロウ",
    example: "シブヤ　タロウ（全角カタカナ）",
  },
  {
    key: "postal",
    label: "郵便番号",
    prompt: "郵便番号を入力してください。全角で入れても半角に直します。",
    convention: "hankakuPostal",
    required: true,
    placeholder: "150-8010",
    example: "150-8010（半角数字7桁）",
  },
  {
    key: "address",
    label: "住所",
    prompt:
      "住所を番地まで正確に入力してください。⚠️ 渋谷区で最も入力間違いの多い項目です。全角に揃えますが、番地の数字を半角で求めるフォームもあるため、確定後の表示で公式フォームの指定に合わせてご確認ください。",
    convention: "zenkaku",
    required: true,
    placeholder: "渋谷区宇田川町１－１",
    example: "渋谷区宇田川町１－１（番地は全角／半角どちらか、フォーム指定に合わせる）",
  },
  {
    key: "building",
    label: "建物名・部屋番号",
    prompt: "建物名・部屋番号があれば入力してください（任意）。",
    convention: "zenkaku",
    required: false,
    placeholder: "○○マンション１０１",
    example: "○○マンション１０１（任意・全角）",
  },
  {
    key: "phone",
    label: "電話番号",
    prompt: "日中に連絡のつく電話番号を入力してください。全角で入れても半角に直します。",
    convention: "hankakuPhone",
    required: true,
    placeholder: "0312345678",
    example: "0312345678（半角数字）",
  },
  {
    key: "email",
    label: "メールアドレス",
    prompt:
      "受付確認メールを受け取る場合はメールアドレスを入力してください（任意）。全角文字は半角に直します。",
    convention: "hankakuAscii",
    required: false,
    placeholder: "taro@example.com",
    example: "taro@example.com（任意・半角英数記号）",
  },
];
