/**
 * Türkçe yerel-duyarlı metin yardımcıları.
 * JS'in varsayılan toLowerCase()'i Türkçe için yanlıştır: "I" -> "i" (doğrusu "ı"), "İ" -> "i̇".
 * Tüm harf karşılaştırmaları ve benzersizlik anahtarları bu dosyadan geçmelidir.
 */
export const TR_LOCALE = 'tr-TR';

/** Trim + çoklu boşlukları tek boşluğa indir + tr-TR küçük harf. Benzersizlik anahtarı olarak kullanılır. */
export function normalizeAnswer(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase(TR_LOCALE);
}

/** Cevap verilen harfle başlıyor mu? (boş cevap -> false) */
export function startsWithLetter(answer: string, letter: string): boolean {
    const a = normalizeAnswer(answer);
    const l = letter.trim().toLocaleLowerCase(TR_LOCALE);
    return a.length > 0 && l.length > 0 && a.startsWith(l);
}
