package bg.teokroze.imoti.core

import kotlinx.serialization.Serializable
import kotlin.math.abs
import kotlin.math.pow

@Serializable
data class PricePoint(val at: Long, val eur: Double)

object PriceHistory {
    /** Append [eur] if it differs from the last recorded price. Returns the new history. */
    fun record(history: List<PricePoint>?, eur: Double, at: Long): List<PricePoint> {
        val h = history.orEmpty()
        val last = h.lastOrNull()
        return if (last != null && abs(last.eur - eur) < 1.0) h else (h + PricePoint(at, eur)).takeLast(20)
    }

    /** How much cheaper the listing is now than its highest recorded price (positive = dropped). */
    fun dropFromPeak(history: List<PricePoint>?): Double {
        val h = history.orEmpty()
        if (h.size < 2) return 0.0
        return (h.maxOf { it.eur } - h.last().eur).coerceAtLeast(0.0)
    }
}

object Duplicates {
    /**
     * Listings that look like the same property on another site: same type, price within 1%
     * and area within 2 m². Agencies often post one property on imot.bg, alo.bg and OLX.
     */
    fun find(listings: List<Listing>): Map<String, List<Listing>> {
        val out = HashMap<String, MutableList<Listing>>()
        val withData = listings.filter { it.priceEur != null && it.areaSqm != null && it.type != PropertyType.OTHER }
        val byType = withData.groupBy { it.type }
        for (group in byType.values) {
            val sorted = group.sortedBy { it.priceEur }
            for (i in sorted.indices) {
                val a = sorted[i]
                var j = i + 1
                while (j < sorted.size && sorted[j].priceEur!! <= a.priceEur!! * 1.01) {
                    val b = sorted[j]
                    if (a.source != b.source && abs(a.areaSqm!! - b.areaSqm!!) <= 2.0) {
                        out.getOrPut(a.id) { mutableListOf() }.add(b)
                        out.getOrPut(b.id) { mutableListOf() }.add(a)
                    }
                    j++
                }
            }
        }
        return out
    }

    /** Keep one listing per duplicate cluster (the first in [listings] order). */
    fun collapse(listings: List<Listing>, dups: Map<String, List<Listing>>): List<Listing> {
        val dropped = HashSet<String>()
        val out = mutableListOf<Listing>()
        for (l in listings) {
            if (l.id in dropped) continue
            out += l
            dups[l.id]?.forEach { dropped += it.id }
        }
        return out
    }
}

object Stats {
    fun pricePerSqm(l: Listing): Double? {
        val p = l.priceEur ?: return null
        val a = l.areaSqm?.takeIf { it >= 10 } ?: return null
        return p / a
    }

    /** Median €/m² per property type over [listings]; types with fewer than 3 data points are left out. */
    fun medianPerSqm(listings: List<Listing>): Map<PropertyType, Double> =
        listings.groupBy { it.type }
            .mapValues { (_, ls) -> ls.mapNotNull(::pricePerSqm).sorted() }
            .filterValues { it.size >= 3 }
            .mapValues { (_, v) -> if (v.size % 2 == 1) v[v.size / 2] else (v[v.size / 2 - 1] + v[v.size / 2]) / 2 }

    /** Monthly annuity payment. */
    fun monthlyPayment(principal: Double, annualRatePct: Double, years: Int): Double {
        val n = years * 12
        if (n <= 0) return 0.0
        val r = annualRatePct / 100 / 12
        if (r == 0.0) return principal / n
        return principal * r / (1 - (1 + r).pow(-n))
    }
}
