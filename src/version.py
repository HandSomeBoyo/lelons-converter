"""The app's version, and where it looks for new versions."""

VERSION = "1.35.0"

# GitHub repository ("owner/name") whose Releases hold new versions of the
# installer. Leave empty to turn the update check off.
UPDATE_REPO = "HandSomeBoyo/lelons-converter"

# The Supabase project that holds the SFX tab's shared sounds (see sfx/setup.sql).
# The key is the project's publishable (anon) key, which is fine to share.
SFX_URL = "https://hjuoeiouotgaapuevflp.supabase.co"
SFX_KEY = "sb_publishable_4cNy4W_7OjXUjGaoxXKneg_-YcdccQ2"

# The Copyright tab looks songs up on AcoustID (acoustid.org). This is the app's key there (an
# application key, meant to ship inside the app).
ACOUSTID_KEY = "gAaOATnWF6"

# The crew's YouTube channels on the Home page (the owner can change them in the app).
CHANNELS = [
    "https://www.youtube.com/@Unclelelon",
    "https://www.youtube.com/@GarlicBreadPete",
    "https://www.youtube.com/@thepivotmaker99",
    "https://www.youtube.com/@MiknelMannen",
]
