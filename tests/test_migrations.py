from sftkit.database import SchemaMigration

from abrechnung.database.migrations import CURRENT_REVISION, MIGRATION_PATH


def test_api_expects_the_latest_migration():
    # The API refuses to start when the database is not at CURRENT_REVISION.
    # A migration added without bumping it takes production down: the
    # migration applies, then nothing starts against the migrated database.
    latest = SchemaMigration.latest_migration(MIGRATION_PATH)
    assert latest is not None
    assert CURRENT_REVISION == latest.version
