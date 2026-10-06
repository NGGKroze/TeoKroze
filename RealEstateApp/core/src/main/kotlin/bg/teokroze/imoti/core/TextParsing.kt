package bg.teokroze.imoti.core

/** Fixed BGN/EUR rate; Bulgaria joined the euro at this rate. */
const val BGN_PER_EUR = 1.95583

object TextParsing {
    private const val NUM = """\d{1,3}(?:[\s  .,]\d{3})+|\d+"""

    private val eurPattern = Regex("""($NUM)(?:[.,](\d{1,2}))?\s*(?:€|EUR|eur|евро)""")
    private val eurPrefixPattern = Regex("""(?:€|EUR)\s*($NUM)(?:[.,](\d{1,2}))?""")
    private val bgnPattern = Regex("""($NUM)(?:[.,](\d{1,2}))?\s*(?:лв|BGN)""")
    private val areaPattern = Regex("""(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:кв\.?\s*м|м2|m2|м²|m²|кв\.м\.)""", RegexOption.IGNORE_CASE)

    // Bulgarian mobile/landline numbers: 0888 123 456, +359 88 812 3456, 082/ 82 12 34 ...
    private val phonePattern = Regex("""(?<![\d])(?:\+359|00359|0)[\s\-/()]*\d(?:[\s\-/()]*\d){7,8}(?![\d])""")
    private val emailPattern = Regex("""[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}""")

    private fun toNumber(intPart: String, frac: String?): Double? {
        val digits = intPart.filter { it.isDigit() }
        if (digits.isEmpty()) return null
        return "$digits.${frac ?: "0"}".toDoubleOrNull()
    }

    /** Price in EUR; BGN prices are converted. Returns null for "по договаряне" etc. */
    fun parsePriceEur(text: String): Double? {
        eurPattern.find(text)?.let { m -> toNumber(m.groupValues[1], m.groupValues[2].ifEmpty { null })?.let { return it } }
        eurPrefixPattern.find(text)?.let { m -> toNumber(m.groupValues[1], m.groupValues[2].ifEmpty { null })?.let { return it } }
        bgnPattern.find(text)?.let { m -> toNumber(m.groupValues[1], m.groupValues[2].ifEmpty { null })?.let { return it / BGN_PER_EUR } }
        return null
    }

    /** The first price-looking fragment as displayed by the site. */
    fun priceText(text: String): String =
        (eurPattern.find(text) ?: eurPrefixPattern.find(text) ?: bgnPattern.find(text))?.value?.trim().orEmpty()

    fun parseAreaSqm(text: String): Double? =
        areaPattern.find(text)?.groupValues?.get(1)?.replace(',', '.')?.toDoubleOrNull()

    fun findPhones(text: String): List<String> =
        phonePattern.findAll(text)
            .map { normalizePhone(it.value) }
            .filter { it.length in 10..13 }
            .distinct()
            .toList()

    fun normalizePhone(raw: String): String {
        val digits = raw.filter { it.isDigit() }
        return when {
            digits.startsWith("00359") -> "+359" + digits.removePrefix("00359")
            digits.startsWith("359") -> "+$digits"
            else -> digits
        }
    }

    fun findEmails(text: String): List<String> =
        emailPattern.findAll(text)
            .map { it.value.trimEnd('.') }
            .filterNot { e -> listOf("example.", "sentry", "wixpress", ".png", ".jpg", ".webp").any { it in e.lowercase() } }
            .distinct()
            .toList()

    fun clean(s: String): String = s.replace(' ', ' ').replace(Regex("\\s+"), " ").trim()
}
