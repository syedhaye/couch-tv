package app.couchtv.launcher

import android.content.Context
import android.content.Intent

/**
 * The Google TV switch. The home's "Google TV" quick button turns it on: from then on the TV's own
 * home (Google TV, or the maker's) is the home, at the Home button and after a restart, and the
 * Home button watch (FireWatch) and the gear button (KeyWatch) stand aside. Opening "My Home" from
 * the TV's own app row turns it off again, and so does apply.sh starting the home on purpose.
 *
 * Nothing is switched on or off in Android itself: it is one saved flag, so the switch can never
 * leave the TV without a home.
 */
object StockMode {
    private const val PREFS = "stock_mode"

    fun on(c: Context): Boolean =
        runCatching { c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("on", false) }.getOrDefault(false)

    fun set(c: Context, on: Boolean) {
        runCatching { c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("on", on).commit() }
    }

    /** Started from a launcher's app row ("My Home"): the person wants this home back. */
    fun fromAppRow(i: Intent?): Boolean =
        i != null && (i.hasCategory(Intent.CATEGORY_LEANBACK_LAUNCHER) || i.hasCategory(Intent.CATEGORY_LAUNCHER))

    /** Started by apply.sh with new settings: this home on purpose. */
    fun fromSetup(i: Intent?): Boolean =
        i != null && (i.hasExtra("bridge") || i.hasExtra("config_b64"))
}
