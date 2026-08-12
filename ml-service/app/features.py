"""Feature definitions shared by training and serving.

Keeping the column lists, the leakage exclusions and the IQSMS -> PHMSA value
mapping in one module is what stops the training pipeline and the inference
service from drifting apart: the FastAPI service imports the same constants
the trainer used.

Every mapping table below was verified against the distinct values actually
present in gd2010toPresent.xlsx, not assumed from the column name.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Target and leakage control (proposal 8.2)
# ---------------------------------------------------------------------------

TARGET_COLUMN = "SIGNIFICANT"

#: SIGNIFICANT is *computed from* these fields. Handing any of them to a model
#: lets it reconstruct the label's own definition, producing near-perfect
#: scores of no predictive value. An accuracy above ~0.95 on this problem is a
#: symptom of leakage, not success. EST_COST* columns are added dynamically in
#: the trainer, since the exact set varies by form revision.
LEAKAGE_COLUMNS = [
    "FATAL",
    "INJURE",
    "FF",
    "SERIOUS",
    "TOTAL_COST",
    "TOTAL_COST_IN84",
    "TOTAL_COST_CURRENT",
]

#: Placeholder for a missing categorical value. Written *before* the column is
#: cast to str during training, so "MISSING" is a category the encoder has
#: genuinely seen and an incomplete incident scores consistently at inference.
MISSING = "MISSING"

# ---------------------------------------------------------------------------
# Feature sets
# ---------------------------------------------------------------------------

#: Set A - circumstances knowable *before* an incident occurs. A model built on
#: these would support prevention. Phase 4 found this to be a null result:
#: accuracy sits at the majority-class baseline. It is trained, reported and
#: served as the documented baseline rather than quietly dropped.
CAT_A = ["MAP_EIGHT_CAUSE", "SYSTEM_PART_INVOLVED", "LOCATION_TYPE"]
NUM_A = ["ACCIDENT_PSIG", "PIPE_DIAMETER"]

#: Set B - set A plus characteristics known once an incident has been logged.
#: Supports severity *triage*, not prevention. This is the default served model.
CAT_B = CAT_A + [
    "IGNITE_IND",
    "EXPLODE_IND",
    "MATERIAL_INVOLVED",
    "RELEASE_TYPE",
    "INCIDENT_AREA_TYPE",
]
NUM_B = NUM_A + ["PIPE_AGE"]

FEATURE_SETS = {
    "A": {
        "categorical": CAT_A,
        "numeric": NUM_A,
        "claim": "prevention",
        "description": "Circumstances only - cause, component, location, pressure, diameter.",
    },
    "B": {
        "categorical": CAT_B,
        "numeric": NUM_B,
        "claim": "triage",
        "description": "Set A plus ignition, explosion, material, release type, area, pipe age.",
    },
}

# ---------------------------------------------------------------------------
# IQSMS enum -> PHMSA training vocabulary
# ---------------------------------------------------------------------------
# The platform stores SCREAMING_SNAKE enums; the model was fitted on PHMSA's
# raw strings. Each table below is exhaustive and 1:1 with the Prisma enum of
# the same name, so no platform option can fall through to an unseen category.

CAUSE_MAP = {
    "CORROSION_FAILURE": "CORROSION",
    "NATURAL_FORCE_DAMAGE": "NATURAL FORCE DAMAGE",
    "EXCAVATION_DAMAGE": "EXCAVATION DAMAGE",
    "OTHER_OUTSIDE_FORCE": "OTHER OUTSIDE FORCE DAMAGE",
    "PIPE_WELD_JOINT_FAILURE": "MATERIAL FAILURE OF PIPE OR WELD",
    "EQUIPMENT_FAILURE": "EQUIPMENT FAILURE",
    "INCORRECT_OPERATION": "INCORRECT OPERATION",
    "OTHER_UNKNOWN": "ALL OTHER CAUSES",
}

SYSTEM_PART_MAP = {
    "MAIN": "MAIN",
    "SERVICE": "SERVICE",
    "SERVICE_RISER": "SERVICE RISER",
    "SERVICE_VALVE": "SERVICE VALVE",
    "MAIN_VALVE": "MAIN VALVE",
    "OUTSIDE_METER_REGULATOR_SET": "OUTSIDE METER/REGULATOR SET",
    "INSIDE_METER_REGULATOR_SET": "INSIDE METER/REGULATOR SET",
    "DISTRICT_REGULATOR_METERING_STATION": "DISTRICT REGULATOR/METERING STATION",
    "FARM_TAP_METER_REGULATOR_SET": "FARM TAP METER/REGULATOR SET",
    "OTHER": "OTHER",
}

LOCATION_TYPE_MAP = {
    "PRIVATE_PROPERTY": "PRIVATE PROPERTY",
    "PUBLIC_PROPERTY": "PUBLIC PROPERTY",
    "UTILITY_ROW_EASEMENT": "UTILITY RIGHT-OF-WAY / EASEMENT",
    "OPERATOR_CONTROLLED_PROPERTY": "OPERATOR-CONTROLLED PROPERTY",
}

RELEASE_TYPE_MAP = {
    "LEAK": "LEAK",
    "RUPTURE": "RUPTURE",
    "MECHANICAL_PUNCTURE": "MECHANICAL PUNCTURE",
    "OTHER": "OTHER",
}

AREA_TYPE_MAP = {
    "UNDERGROUND": "UNDERGROUND",
    "ABOVEGROUND": "ABOVEGROUND",
    "TRANSITION_AREA": "TRANSITION AREA",
}

MATERIAL_MAP = {
    "STEEL": "STEEL",
    "PLASTIC": "PLASTIC",
    "CAST_WROUGHT_IRON": "CAST/WROUGHT IRON",
    "DUCTILE_IRON": "DUCTILE IRON",
    "COPPER": "COPPER",
    "UNKNOWN": "UNKNOWN",
    "OTHER": "OTHER",
}


def _map(value, table):
    if value is None:
        return MISSING
    return table.get(str(value).upper(), MISSING)


def yes_no(value) -> str:
    """PHMSA indicator columns hold the strings 'YES'/'NO', not booleans."""
    if value is None:
        return MISSING
    return "YES" if bool(value) else "NO"


def to_model_row(payload: dict) -> dict:
    """Translate an IQSMS incident payload into one training-vocabulary row."""
    return {
        "MAP_EIGHT_CAUSE": _map(payload.get("causeCategory"), CAUSE_MAP),
        "SYSTEM_PART_INVOLVED": _map(payload.get("systemPart"), SYSTEM_PART_MAP),
        "LOCATION_TYPE": _map(payload.get("locationType"), LOCATION_TYPE_MAP),
        "ACCIDENT_PSIG": payload.get("linePressurePsig"),
        "PIPE_DIAMETER": payload.get("pipeDiameterInches"),
        "IGNITE_IND": yes_no(payload.get("ignitionOccurred")),
        "EXPLODE_IND": yes_no(payload.get("explosionOccurred")),
        "MATERIAL_INVOLVED": _map(payload.get("pipeMaterial"), MATERIAL_MAP),
        "RELEASE_TYPE": _map(payload.get("releaseType"), RELEASE_TYPE_MAP),
        "INCIDENT_AREA_TYPE": _map(payload.get("incidentAreaType"), AREA_TYPE_MAP),
        "PIPE_AGE": payload.get("pipeAgeYears"),
    }
