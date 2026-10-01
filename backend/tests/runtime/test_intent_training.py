"""The routing training set and the classifier stay honest and reproducible.

- The committed training set is exactly what the grammar, the FAQ questions and the catalog
  produce (nobody edits it by hand to fit an evaluation set).
- No training message overlaps an evaluation question (Jaccard >= 0.6), and none comes near the
  two blind sets (BlindGuard), whose author also wrote the grammar.
- The committed model was trained on the committed training set.
"""

from __future__ import annotations

import hashlib
import json

import yaml

from atrium.runtime.intent import MODEL_PATH
from atrium.runtime.intent_train import TRAIN_PATH, BlindGuard, build_training, overlapping, render_training


def test_committed_training_set_is_reproducible_from_its_sources():
    items, report = build_training()
    assert render_training(items, report) == TRAIN_PATH.read_text()


def test_no_training_message_overlaps_an_evaluation_question_or_comes_near_a_blind_set():
    items = yaml.safe_load(TRAIN_PATH.read_text())["items"]
    assert not overlapping([i["q"] for i in items])
    guard = BlindGuard()
    assert not [i["q"] for i in items if guard.violates(i["q"])]


def test_committed_model_was_trained_on_the_committed_training_set():
    model = json.loads(MODEL_PATH.read_text())
    assert model["training_sha256"] == hashlib.sha256(TRAIN_PATH.read_text().encode()).hexdigest()
