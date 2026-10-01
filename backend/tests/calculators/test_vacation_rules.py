"""CLT vacation rules and the window optimizer."""

from datetime import date, timedelta

from atrium.calculators.holidays import holiday_map, is_non_working
from atrium.calculators.vacation import (
    Fraction,
    PeriodState,
    best_windows,
    entitlement_for_absences,
    partitions,
    plan_balance,
    start_issues,
    validate_request,
)

HMAP = holiday_map([2026, 2027, 2028])
TODAY = date(2026, 10, 1)


def codes(issues):
    return {i.code for i in issues}


def period(**kw):
    base = dict(acquisition_start=date(2025, 3, 4), acquisition_end=date(2026, 3, 3), entitled_days=30)
    base.update(kw)
    return PeriodState(**base)


def test_entitlement_by_absences_art_130():
    assert [entitlement_for_absences(n) for n in (0, 5, 6, 14, 15, 23, 24, 32, 33)] == [30, 30, 24, 24, 18, 18, 12, 12, 0]


def test_cannot_start_two_days_before_holiday_or_sunday():
    assert "start_before_rest" in codes(start_issues(date(2026, 11, 6), HMAP))  # Friday
    assert "start_before_holiday" in codes(start_issues(date(2026, 11, 18), HMAP))  # Wed, 20/11 is Friday
    assert "start_non_working" in codes(start_issues(date(2026, 11, 2), HMAP))  # Finados
    assert start_issues(date(2026, 11, 23), HMAP) == []  # Monday


def test_split_rules_one_fraction_of_14_and_minimum_5():
    p = period(fractions=[Fraction(date(2026, 7, 6), 10)])  # balance 20, no 14-day fraction yet
    assert "needs_14_day_fraction" in codes(validate_request(p, date(2026, 11, 23), 8, 0, HMAP, TODAY))
    assert "min_5" in codes(validate_request(p, date(2026, 11, 23), 4, 0, HMAP, TODAY))
    ok = validate_request(p, date(2026, 11, 23), 15, 0, HMAP, TODAY)
    assert not [i for i in ok if i.severity == "error"]


def test_third_fraction_must_consume_the_balance():
    p = period(fractions=[Fraction(date(2026, 3, 9), 14), Fraction(date(2026, 7, 6), 6)])  # balance 10
    issues = validate_request(p, date(2026, 11, 23), 5, 0, HMAP, TODAY)
    assert "remainder_without_fraction" in codes(issues)
    assert not [i for i in validate_request(p, date(2026, 11, 23), 10, 0, HMAP, TODAY) if i.severity == "error"]


def test_notice_overlap_and_double_pay():
    p = period(fractions=[Fraction(date(2026, 11, 23), 14)])
    assert "notice_30_days" in codes(validate_request(p, date(2026, 10, 13), 10, 0, HMAP, TODAY))
    assert "overlap" in codes(validate_request(p, date(2026, 11, 30), 10, 0, HMAP, TODAY))
    late = validate_request(p, date(2027, 2, 24), 16, 0, HMAP, TODAY)
    assert "double_pay" in codes(late)


def test_abono_limited_to_one_third():
    p = period()
    assert "abono_max_third" in codes(validate_request(p, date(2026, 11, 23), 19, 11, HMAP, TODAY))


def test_windows_start_on_valid_days_and_maximize_rest():
    windows = best_windows([5, 10, 15], HMAP, date(2026, 10, 31), date(2027, 9, 30), top=8)
    assert windows
    for w in windows:
        assert start_issues(w.start, HMAP) == []
        assert w.rest_days >= w.days
        # The rest block is bounded by working days on both sides.
        assert not is_non_working(w.rest_start - timedelta(days=1), HMAP)
        assert not is_non_working(w.rest_end + timedelta(days=1), HMAP)
    effs = [w.rest_days / w.days for w in windows]
    assert effs == sorted(effs, reverse=True)


def test_partitions_respect_clt():
    for parts in partitions(30, 3, needs_main=True):
        assert sum(parts) == 30 and len(parts) <= 3
        assert max(parts) >= 14 and min(parts) >= 5
    assert partitions(20, 2, needs_main=True) == [(20,), (15, 5), (14, 6)]


def test_plan_uses_whole_balance_within_deadline():
    p = period(fractions=[Fraction(date(2026, 7, 6), 10)])
    plans = plan_balance(p, HMAP, date(2026, 10, 31), p.deadline)
    assert plans
    for plan in plans:
        assert plan.used_days == p.balance
        assert any(w.days >= 14 for w in plan.windows)
        assert all(w.end <= p.deadline for w in plan.windows)
    assert plans[0].rest_days >= plans[-1].rest_days
