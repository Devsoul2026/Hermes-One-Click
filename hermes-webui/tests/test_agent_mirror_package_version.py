"""Package semver from agent checkout pyproject.toml (api.agent_mirror)."""

from api.agent_mirror import _read_agent_package_version


def test_read_agent_package_version_from_pyproject(tmp_path):
    (tmp_path / "pyproject.toml").write_text(
        '[build-system]\nrequires = ["setuptools"]\nbuild-backend = "setuptools.build_meta"\n\n'
        '[project]\nname = "hermes-agent"\nversion = "0.11.0"\n',
        encoding="utf-8",
    )
    assert _read_agent_package_version(tmp_path) == "0.11.0"


def test_read_agent_package_version_missing(tmp_path):
    assert _read_agent_package_version(tmp_path) is None
