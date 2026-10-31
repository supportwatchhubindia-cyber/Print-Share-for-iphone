package com.printshare.companion.usb

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceIdTest {
    @Test
    fun parsesLongAndShortKeys() {
        val id = DeviceId.parse("MANUFACTURER:Hewlett-Packard;COMMAND SET:PCL5E,PJL;MDL:HP LaserJet 4000;CLS:PRINTER;")
        assertEquals("Hewlett-Packard", id.manufacturer)
        assertEquals("HP LaserJet 4000", id.model)
        assertEquals(listOf("PCL5E", "PJL"), id.commandSet)
        assertEquals("PRINTER", id.deviceClass)
    }

    @Test
    fun readsLengthPrefixedResponse() {
        val text = "MFG:HP;MDL:Test;"
        val bytes = byteArrayOf(0, (text.length + 2).toByte()) + text.toByteArray() + ByteArray(20)
        assertEquals("Test", DeviceId.fromResponse(bytes, bytes.size)!!.model)
        assertNull(DeviceId.fromResponse(byteArrayOf(0, 2), 2))
    }
}

class CompatibilityTest {
    private val hp = Compatibility.HP_VENDOR_ID

    @Test
    fun hpM1005IsHostBasedEvenWithoutDeviceId() {
        val a = Compatibility.assess(null, hasPrinterInterface = true, vendorId = hp, productName = "HP LaserJet M1005")
        assertEquals(Verdict.HOST_BASED, a.verdict)
        assertFalse(a.canPrintDirectly)
        assertTrue(a.detail.contains("PrintShare Bridge"))
    }

    @Test
    fun hpM1005IsHostBasedFromDeviceId() {
        val id = DeviceId.parse("MFG:Hewlett-Packard;MDL:HP LaserJet M1005;CLS:PRINTER;")
        assertEquals(Verdict.HOST_BASED, Compatibility.assess(id, true, hp, null).verdict)
    }

    @Test
    fun hostBasedCommandSetsAreRejected() {
        val id = DeviceId.parse("MFG:Hewlett-Packard;MDL:HP LaserJet 1020;CMD:ZJS;")
        assertEquals(Verdict.HOST_BASED, Compatibility.assess(id, true, hp, null).verdict)
    }

    @Test
    fun pclPrintersCanPrintDirectly() {
        val id = DeviceId.parse("MFG:Hewlett-Packard;MDL:HP LaserJet P2035;CMD:PJL,PCL5E,PCL6;")
        val a = Compatibility.assess(id, true, hp, null)
        assertEquals(Verdict.DIRECT_PCL, a.verdict)
        assertTrue(a.canPrintDirectly)
    }

    @Test
    fun postscriptOnlyIsNotImplemented() {
        val id = DeviceId.parse("MFG:Acme;MDL:PS Printer;CMD:POSTSCRIPT;")
        assertEquals(Verdict.LANGUAGE_NOT_IMPLEMENTED, Compatibility.assess(id, true, 0x1234, null).verdict)
    }

    @Test
    fun unknownNeverClaimsSupport() {
        assertEquals(Verdict.UNKNOWN, Compatibility.assess(DeviceId.parse("MFG:X;MDL:Y;"), true, 0x1234, null).verdict)
        assertEquals(Verdict.NOT_A_PRINTER, Compatibility.assess(null, false, 0x1234, "USB stick").verdict)
    }
}

class PclRasterEncoderTest {
    private fun bytes(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }

    @Test
    fun packBitsMatchesAppleTechNote1023() {
        val input = bytes(0xAA, 0xAA, 0xAA, 0x80, 0x00, 0x2A, 0xAA, 0xAA, 0xAA, 0xAA, 0x80, 0x00, 0x2A, 0x22,
            0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA)
        val expected = bytes(0xFE, 0xAA, 0x02, 0x80, 0x00, 0x2A, 0xFD, 0xAA, 0x03, 0x80, 0x00, 0x2A, 0x22, 0xF7, 0xAA)
        assertArrayEquals(expected, PclRasterEncoder.packBits(input))
    }

    @Test
    fun packBitsHandlesLongRunsAndLiterals() {
        // 129 zeros: a maximal 128-byte run, then a 1-byte literal.
        assertArrayEquals(bytes(0x81, 0x00, 0x00, 0x00), PclRasterEncoder.packBits(ByteArray(129)))
        val literal = ByteArray(130) { it.toByte() }
        val packed = PclRasterEncoder.packBits(literal)
        assertEquals(127, packed[0].toInt())        // 128 literal bytes
        assertEquals(1, packed[129].toInt())         // then 2 more
        assertEquals(130 + 2, packed.size)
    }

    @Test
    fun pageHasRasterFramingAndFormFeed() {
        val page = PclRasterEncoder.page(listOf(ByteArray(10), ByteArray(10) { 0xFF.toByte() }), 80, 300, PclRasterEncoder.Paper.A4)
        val text = String(page, Charsets.ISO_8859_1)
        assertTrue(text.contains("\u001B&l26A"))
        assertTrue(text.contains("\u001B*t300R"))
        assertTrue(text.contains("\u001B*r80S"))
        assertTrue(text.contains("\u001B*r1A"))
        assertTrue(text.contains("\u001B*rB"))
        assertEquals(0x0C, page.last().toInt())
    }
}
