// -PcoreOnly builds just the parser module on a plain JVM (no Android SDK / Google Maven needed).
val coreOnly = providers.gradleProperty("coreOnly").isPresent

pluginManagement {
    // Versions are declared here (not in a root build file) so a core-only build never resolves the Android plugin.
    plugins {
        id("com.android.application") version "8.7.3"
        id("org.jetbrains.kotlin.android") version "2.1.0"
        id("org.jetbrains.kotlin.jvm") version "2.1.0"
        id("org.jetbrains.kotlin.plugin.compose") version "2.1.0"
        id("org.jetbrains.kotlin.plugin.serialization") version "2.1.0"
    }
    repositories {
        if (!providers.gradleProperty("coreOnly").isPresent) google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        if (!coreOnly) google()
        mavenCentral()
    }
}

rootProject.name = "ImotiRuse"
include(":core")
if (!coreOnly) include(":app")
