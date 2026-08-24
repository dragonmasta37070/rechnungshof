import os
import tempfile
from pathlib import Path

from abrechnung.config import read_config

docker_base_config = (Path(__file__).parent.parent / "docker" / "abrechnung.yaml").read_text()


def test_config_load_from_env():
    os.environ["ABRECHNUNG_SERVICE__NAME"] = "my abrechnung"
    os.environ["ABRECHNUNG_API__SECRET_KEY"] = "secret"
    os.environ["ABRECHNUNG_DATABASE__HOST"] = "localhost"
    os.environ["ABRECHNUNG_DATABASE__DBNAME"] = "abrechnung"
    os.environ["ABRECHNUNG_DATABASE__PASSWORD"] = "password"
    os.environ["ABRECHNUNG_DATABASE__USER"] = "abrechnung"
    os.environ["ABRECHNUNG_OIDC__AUDIENCE"] = "rechnungshof-from-env"
    with tempfile.NamedTemporaryFile() as f:
        filename = Path(f.name)
        filename.write_text(docker_base_config, "utf-8")

        loaded_cfg = read_config(filename)

        assert loaded_cfg.service.name == "my abrechnung"
        assert loaded_cfg.api.secret_key == "secret"
        assert loaded_cfg.database.user == "abrechnung"
        assert loaded_cfg.database.host == "localhost"
        assert loaded_cfg.database.dbname == "abrechnung"
        assert loaded_cfg.database.password == "password"
        # The OIDC section comes from the yaml file, but the audience is overridden
        # from the environment — which is exactly how it is deployed.
        assert loaded_cfg.oidc.audience == "rechnungshof-from-env"
        assert loaded_cfg.oidc.issuer.startswith("https://")
        assert loaded_cfg.oidc.jwks_url.endswith("/jwks/")
