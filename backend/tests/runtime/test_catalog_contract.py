"""The governed catalog and the implementations agree, and self-service tools cannot name a subject."""

import yaml

from atrium.config import REPO_ROOT
from atrium.runtime.registry import all_tools, tool_catalog
from atrium.runtime.tool import Risk

SUBJECT_FIELDS = {"employee_id", "subject", "subject_id", "colleague", "person", "target", "user_id"}


def test_every_catalog_tool_is_implemented_and_vice_versa():
    assert set(tool_catalog()) == set(all_tools())


def test_agents_only_reference_catalog_tools():
    agents = yaml.safe_load((REPO_ROOT / "shared/catalog/agents.yaml").read_text())["agents"]
    assert len(agents) == 14
    for a in agents:
        assert set(a["tools"]) <= set(tool_catalog()), a["id"]


def test_write_tools_have_executors_and_reads_do_not():
    for t in all_tools().values():
        assert (t.executor is not None) == (t.risk is not Risk.READ), t.name


def test_self_service_schemas_expose_no_subject_parameter():
    for t in all_tools().values():
        props = set(t.schema()["function"]["parameters"].get("properties", {}))
        assert t.schema()["function"]["parameters"]["additionalProperties"] is False
        if t.subject == "self":
            assert not props & SUBJECT_FIELDS, (t.name, props)
