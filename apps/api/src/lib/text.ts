const STOPWORDS = new Set(
  (
    "the and for that with this from into your you want make would could should about have " +
    "app idea some like just what when then than them they their there which will can " +
    "это как что для чтобы или его она они мне меня хочу сделать можно было будет если " +
    "тоже только ещё еще уже при над под без про"
  ).split(" "),
);

/** Lowercased words of 3+ letters/digits, minus common filler words (English and Russian). */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOPWORDS.has(w));
}