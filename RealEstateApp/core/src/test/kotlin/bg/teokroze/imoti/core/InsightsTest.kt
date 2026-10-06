package bg.teokroze.imoti.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class InsightsTest {
    @Test
    fun gazetteer() {
        val a = assertIs<GeoResult.Known>(Gazetteer.resolve("Русе, Дружба 3"))
        assertEquals("Русе, Дружба 3", a.label)
        val b = assertIs<GeoResult.Known>(Gazetteer.resolve("град Русе, Широк център"))
        assertEquals("Русе, Широк център", b.label)
        val c = assertIs<GeoResult.Lookup>(Gazetteer.resolve("село Николово"))
        assertEquals("Николово, област Русе", c.query)
        assertIs<GeoResult.Known>(Gazetteer.resolve("", "Продава КЪЩА гр. Бяла"))
        assertIs<GeoResult.Lookup>(Gazetteer.resolve("Пиргово"))
        assertEquals(Gazetteer.RUSE_CENTER, assertIs<GeoResult.Known>(Gazetteer.resolve("Русе")).point)
        assertEquals(null, Gazetteer.resolve(""))
    }

    @Test
    fun priceHistory() {
        var h = PriceHistory.record(null, 100_000.0, 1)
        h = PriceHistory.record(h, 100_000.4, 2)
        assertEquals(1, h.size)
        h = PriceHistory.record(h, 95_000.0, 3)
        assertEquals(5_000.0, PriceHistory.dropFromPeak(h))
        h = PriceHistory.record(h, 99_000.0, 4)
        assertEquals(1_000.0, PriceHistory.dropFromPeak(h))
    }

    @Test
    fun duplicatesAndStats() {
        fun l(src: Source, id: String, price: Double, area: Double, type: PropertyType = PropertyType.ROOM_3) =
            Listing(src, id, "u", "t", priceEur = price, areaSqm = area, type = type)
        val a = l(Source.IMOT_BG, "1", 120_000.0, 85.0)
        val b = l(Source.ALO_BG, "2", 120_500.0, 86.0)
        val c = l(Source.OLX_BG, "3", 150_000.0, 85.0)
        val d = l(Source.ALO_BG, "4", 120_000.0, 85.0, PropertyType.HOUSE)
        val dups = Duplicates.find(listOf(a, b, c, d))
        assertEquals(listOf("2"), dups[a.id]?.map { it.nativeId })
        assertEquals(null, dups[c.id])
        assertEquals(listOf(a, c, d), Duplicates.collapse(listOf(a, b, c, d), dups))

        val med = Stats.medianPerSqm(listOf(a, b, c, l(Source.OLX_BG, "5", 100_000.0, 100.0)))
        assertTrue(med[PropertyType.ROOM_3]!! in 1_400.0..1_420.0, med.toString())
        assertEquals(400.34, Stats.monthlyPayment(100_000.0, 2.6, 30), 0.5)
    }
}
