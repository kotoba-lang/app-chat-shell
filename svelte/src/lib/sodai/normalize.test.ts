// 実行: node --test src/lib/sodai/normalize.test.ts  (Node 22+ 型ストリップ)
// 追加依存なし。ユーザーが申告した「大文字・小文字・全角で弾かれる」失敗ケースを
// そのまま検証の対象にする。これが本機能の実契約。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toHankakuAscii,
  toZenkakuAscii,
  toHankakuDigits,
  hiraganaToKatakana,
  hankakuKatakanaToZenkaku,
  toZenkakuKatakana,
  normalizeField,
  isFullwidthKatakana,
} from "./normalize.ts";

test("全角ASCII→半角: 全角英字・記号・@ が半角になる (メール失敗の主因)", () => {
  assert.equal(toHankakuAscii("ＴＡＲＯ＠ＥＸＡＭＰＬＥ．ＣＯＭ"), "TARO@EXAMPLE.COM");
  assert.equal(toHankakuAscii("ａｂｃ１２３"), "abc123");
  assert.equal(toHankakuAscii("　"), " "); // 全角スペース→半角
});

test("半角ASCII→全角 (住所など全角必須フィールド)", () => {
  assert.equal(toZenkakuAscii("1-2-3"), "１－２－３");
  assert.equal(toZenkakuAscii("A"), "Ａ");
});

test("全角数字→半角 (電話・郵便)", () => {
  assert.equal(toHankakuDigits("０９０１２３４５６７８"), "09012345678");
});

test("ひらがな→カタカナ", () => {
  assert.equal(hiraganaToKatakana("しぶや たろう"), "シブヤ タロウ");
});

test("半角カナ→全角カナ: 濁点・半濁点を合成", () => {
  assert.equal(hankakuKatakanaToZenkaku("ｶﾞﾌﾟ"), "ガプ");
  assert.equal(hankakuKatakanaToZenkaku("ｼﾌﾞﾔ"), "シブヤ");
  assert.equal(hankakuKatakanaToZenkaku("ﾊﾟﾝﾀﾞ"), "パンダ");
});

test("toZenkakuKatakana: ひらがな・半角カナ混在をすべて全角カタカナへ", () => {
  assert.equal(toZenkakuKatakana("しぶやﾀﾛｳ"), "シブヤタロウ");
});

test("フリガナ field: ひらがな入力を全角カタカナに正規化し changed=true", () => {
  const r = normalizeField("しぶや たろう", "zenkakuKatakana");
  assert.equal(r.value, "シブヤ タロウ");
  assert.equal(r.changed, true);
  assert.equal(r.warnings.length, 0);
  assert.ok(isFullwidthKatakana(r.value));
});

test("フリガナ field: ローマ字混入は警告を出す", () => {
  const r = normalizeField("シブヤtaro", "zenkakuKatakana");
  assert.ok(r.warnings.length > 0);
});

test("メール field: 全角→半角、空白除去、大文字小文字は保持", () => {
  const r = normalizeField(" Ｔａｒｏ＠Ｇftd．Ｃｏ．ｊｐ ", "hankakuAscii");
  assert.equal(r.value, "Taro@etzhayyim.com");
  assert.equal(r.changed, true);
  assert.equal(r.warnings.length, 0);
});

test("電話 field: 全角・ハイフン・括弧を半角数字のみに", () => {
  const r = normalizeField("（０３）６８３４－４７７７", "hankakuPhone");
  assert.equal(r.value, "0368344777");
  assert.equal(r.warnings.length, 0);
});

test("電話 field: 桁数不足は警告", () => {
  const r = normalizeField("123", "hankakuPhone");
  assert.ok(r.warnings.length > 0);
});

test("郵便番号 field: 7桁を NNN-NNNN に整形 (全角入力も可)", () => {
  assert.equal(normalizeField("１５０８０１０", "hankakuPostal").value, "150-8010");
  assert.equal(normalizeField("150-8010", "hankakuPostal").value, "150-8010");
});

test("住所 field: 半角英数を全角へ、前後空白trim", () => {
  const r = normalizeField("  渋谷区宇田川町1-1  ", "zenkaku");
  assert.equal(r.value, "渋谷区宇田川町１－１");
  assert.equal(r.changed, true);
});

test("冪等性: 正規化済みの値を再投入しても変化しない", () => {
  for (const [v, c] of [
    ["シブヤ タロウ", "zenkakuKatakana"],
    ["taro@etzhayyim.com", "hankakuAscii"],
    ["0368344777", "hankakuPhone"],
    ["150-8010", "hankakuPostal"],
    ["渋谷区宇田川町１－１", "zenkaku"],
  ] as const) {
    const once = normalizeField(v, c).value;
    const twice = normalizeField(once, c).value;
    assert.equal(once, twice, `${c} not idempotent`);
  }
});
