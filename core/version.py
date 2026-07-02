"""Central version constants for the Newsletter Creator app.

APP_VERSION follows semantic versioning (MAJOR.MINOR.PATCH).
SCHEMA_VERSIONS maps each data file / store to its current schema integer.
Bump the integer when the on-disk format changes in a non-backward-compatible way.
"""

APP_VERSION = "1.3.0"

SCHEMA_VERSIONS: dict[str, int] = {
    "images":    1,   # data/images.json  — envelope format introduced in 1.1.0
    "jobs":      1,   # data/jobs.json
    "project":   1,   # data/projects/*.json
    "preset":    1,   # data/presets.json
    "template":  1,   # data/templates/*.json
    "resources": 1,   # data/resources.json — attached PDFs and file resources
}
