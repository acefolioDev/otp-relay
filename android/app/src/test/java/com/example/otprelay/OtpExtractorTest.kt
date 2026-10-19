package com.example.otprelay
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OtpExtractorUnitTest {
    @Test fun easypaisaMixedCase() = assertEquals("Ab7Cd9Ef2G", OtpExtractor.extract("Your easypaisa mobile account registration/login OTP is Ab7Cd9Ef2G OTP aur PIN ko mahfooz rakhein"))
    @Test fun numericLeadingZeros() = assertEquals("001234", OtpExtractor.extract("Your OTP is 001234"))
    @Test fun excludesRetrieverHash() = assertEquals("Ab7Cd9Ef2G", OtpExtractor.extract("<#> OTP is Ab7Cd9Ef2G\nFA+9qCX9VSu"))
    @Test fun hashOnlyIsNotCode() = assertNull(OtpExtractor.extract("Login OTP\nAb7Cd9Ef2Gh"))
    @Test fun requiresApprovedSender() = assertNull(OtpExtractor.extractApproved("UNAPPROVED", listOf("EASYPAISA"), "OTP is Ab7Cd9Ef2G"))
}
