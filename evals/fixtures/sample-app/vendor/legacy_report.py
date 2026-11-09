"""Legacy report helpers (vendored). Large on purpose: eval fixture for search-then-read."""

import math

def report_section_001(rows):
    """Summarise section 1 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v1", 0)
    if total > 1001:
        return {"section": 1, "total": total, "flag": "high"}
    return {"section": 1, "total": total, "flag": "ok"}


def report_section_002(rows):
    """Summarise section 2 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v2", 0)
    if total > 1002:
        return {"section": 2, "total": total, "flag": "high"}
    return {"section": 2, "total": total, "flag": "ok"}


def report_section_003(rows):
    """Summarise section 3 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v3", 0)
    if total > 1003:
        return {"section": 3, "total": total, "flag": "high"}
    return {"section": 3, "total": total, "flag": "ok"}


def report_section_004(rows):
    """Summarise section 4 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v4", 0)
    if total > 1004:
        return {"section": 4, "total": total, "flag": "high"}
    return {"section": 4, "total": total, "flag": "ok"}


def report_section_005(rows):
    """Summarise section 5 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v5", 0)
    if total > 1005:
        return {"section": 5, "total": total, "flag": "high"}
    return {"section": 5, "total": total, "flag": "ok"}


def report_section_006(rows):
    """Summarise section 6 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v6", 0)
    if total > 1006:
        return {"section": 6, "total": total, "flag": "high"}
    return {"section": 6, "total": total, "flag": "ok"}


def report_section_007(rows):
    """Summarise section 7 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v7", 0)
    if total > 1007:
        return {"section": 7, "total": total, "flag": "high"}
    return {"section": 7, "total": total, "flag": "ok"}


def report_section_008(rows):
    """Summarise section 8 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v8", 0)
    if total > 1008:
        return {"section": 8, "total": total, "flag": "high"}
    return {"section": 8, "total": total, "flag": "ok"}


def report_section_009(rows):
    """Summarise section 9 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v9", 0)
    if total > 1009:
        return {"section": 9, "total": total, "flag": "high"}
    return {"section": 9, "total": total, "flag": "ok"}


def report_section_010(rows):
    """Summarise section 10 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v10", 0)
    if total > 1010:
        return {"section": 10, "total": total, "flag": "high"}
    return {"section": 10, "total": total, "flag": "ok"}


def report_section_011(rows):
    """Summarise section 11 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v11", 0)
    if total > 1011:
        return {"section": 11, "total": total, "flag": "high"}
    return {"section": 11, "total": total, "flag": "ok"}


def report_section_012(rows):
    """Summarise section 12 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v12", 0)
    if total > 1012:
        return {"section": 12, "total": total, "flag": "high"}
    return {"section": 12, "total": total, "flag": "ok"}


def report_section_013(rows):
    """Summarise section 13 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v13", 0)
    if total > 1013:
        return {"section": 13, "total": total, "flag": "high"}
    return {"section": 13, "total": total, "flag": "ok"}


def report_section_014(rows):
    """Summarise section 14 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v14", 0)
    if total > 1014:
        return {"section": 14, "total": total, "flag": "high"}
    return {"section": 14, "total": total, "flag": "ok"}


def report_section_015(rows):
    """Summarise section 15 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v15", 0)
    if total > 1015:
        return {"section": 15, "total": total, "flag": "high"}
    return {"section": 15, "total": total, "flag": "ok"}


def report_section_016(rows):
    """Summarise section 16 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v16", 0)
    if total > 1016:
        return {"section": 16, "total": total, "flag": "high"}
    return {"section": 16, "total": total, "flag": "ok"}


def report_section_017(rows):
    """Summarise section 17 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v17", 0)
    if total > 1017:
        return {"section": 17, "total": total, "flag": "high"}
    return {"section": 17, "total": total, "flag": "ok"}


def report_section_018(rows):
    """Summarise section 18 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v18", 0)
    if total > 1018:
        return {"section": 18, "total": total, "flag": "high"}
    return {"section": 18, "total": total, "flag": "ok"}


def report_section_019(rows):
    """Summarise section 19 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v19", 0)
    if total > 1019:
        return {"section": 19, "total": total, "flag": "high"}
    return {"section": 19, "total": total, "flag": "ok"}


def report_section_020(rows):
    """Summarise section 20 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v20", 0)
    if total > 1020:
        return {"section": 20, "total": total, "flag": "high"}
    return {"section": 20, "total": total, "flag": "ok"}


def report_section_021(rows):
    """Summarise section 21 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v21", 0)
    if total > 1021:
        return {"section": 21, "total": total, "flag": "high"}
    return {"section": 21, "total": total, "flag": "ok"}


def report_section_022(rows):
    """Summarise section 22 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v22", 0)
    if total > 1022:
        return {"section": 22, "total": total, "flag": "high"}
    return {"section": 22, "total": total, "flag": "ok"}


def report_section_023(rows):
    """Summarise section 23 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v23", 0)
    if total > 1023:
        return {"section": 23, "total": total, "flag": "high"}
    return {"section": 23, "total": total, "flag": "ok"}


def report_section_024(rows):
    """Summarise section 24 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v24", 0)
    if total > 1024:
        return {"section": 24, "total": total, "flag": "high"}
    return {"section": 24, "total": total, "flag": "ok"}


def report_section_025(rows):
    """Summarise section 25 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v25", 0)
    if total > 1025:
        return {"section": 25, "total": total, "flag": "high"}
    return {"section": 25, "total": total, "flag": "ok"}


def report_section_026(rows):
    """Summarise section 26 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v26", 0)
    if total > 1026:
        return {"section": 26, "total": total, "flag": "high"}
    return {"section": 26, "total": total, "flag": "ok"}


def report_section_027(rows):
    """Summarise section 27 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v27", 0)
    if total > 1027:
        return {"section": 27, "total": total, "flag": "high"}
    return {"section": 27, "total": total, "flag": "ok"}


def report_section_028(rows):
    """Summarise section 28 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v28", 0)
    if total > 1028:
        return {"section": 28, "total": total, "flag": "high"}
    return {"section": 28, "total": total, "flag": "ok"}


def report_section_029(rows):
    """Summarise section 29 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v29", 0)
    if total > 1029:
        return {"section": 29, "total": total, "flag": "high"}
    return {"section": 29, "total": total, "flag": "ok"}


def report_section_030(rows):
    """Summarise section 30 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v30", 0)
    if total > 1030:
        return {"section": 30, "total": total, "flag": "high"}
    return {"section": 30, "total": total, "flag": "ok"}


def report_section_031(rows):
    """Summarise section 31 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v31", 0)
    if total > 1031:
        return {"section": 31, "total": total, "flag": "high"}
    return {"section": 31, "total": total, "flag": "ok"}


def report_section_032(rows):
    """Summarise section 32 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v32", 0)
    if total > 1032:
        return {"section": 32, "total": total, "flag": "high"}
    return {"section": 32, "total": total, "flag": "ok"}


def report_section_033(rows):
    """Summarise section 33 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v33", 0)
    if total > 1033:
        return {"section": 33, "total": total, "flag": "high"}
    return {"section": 33, "total": total, "flag": "ok"}


def report_section_034(rows):
    """Summarise section 34 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v34", 0)
    if total > 1034:
        return {"section": 34, "total": total, "flag": "high"}
    return {"section": 34, "total": total, "flag": "ok"}


def report_section_035(rows):
    """Summarise section 35 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v35", 0)
    if total > 1035:
        return {"section": 35, "total": total, "flag": "high"}
    return {"section": 35, "total": total, "flag": "ok"}


def report_section_036(rows):
    """Summarise section 36 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v36", 0)
    if total > 1036:
        return {"section": 36, "total": total, "flag": "high"}
    return {"section": 36, "total": total, "flag": "ok"}


def report_section_037(rows):
    """Summarise section 37 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v37", 0)
    if total > 1037:
        return {"section": 37, "total": total, "flag": "high"}
    return {"section": 37, "total": total, "flag": "ok"}


def report_section_038(rows):
    """Summarise section 38 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v38", 0)
    if total > 1038:
        return {"section": 38, "total": total, "flag": "high"}
    return {"section": 38, "total": total, "flag": "ok"}


def report_section_039(rows):
    """Summarise section 39 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v39", 0)
    if total > 1039:
        return {"section": 39, "total": total, "flag": "high"}
    return {"section": 39, "total": total, "flag": "ok"}


def report_section_040(rows):
    """Summarise section 40 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v40", 0)
    if total > 1040:
        return {"section": 40, "total": total, "flag": "high"}
    return {"section": 40, "total": total, "flag": "ok"}


def report_section_041(rows):
    """Summarise section 41 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v41", 0)
    if total > 1041:
        return {"section": 41, "total": total, "flag": "high"}
    return {"section": 41, "total": total, "flag": "ok"}


def report_section_042(rows):
    """Summarise section 42 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v42", 0)
    if total > 1042:
        return {"section": 42, "total": total, "flag": "high"}
    return {"section": 42, "total": total, "flag": "ok"}


def report_section_043(rows):
    """Summarise section 43 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v43", 0)
    if total > 1043:
        return {"section": 43, "total": total, "flag": "high"}
    return {"section": 43, "total": total, "flag": "ok"}


def report_section_044(rows):
    """Summarise section 44 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v44", 0)
    if total > 1044:
        return {"section": 44, "total": total, "flag": "high"}
    return {"section": 44, "total": total, "flag": "ok"}


def report_section_045(rows):
    """Summarise section 45 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v45", 0)
    if total > 1045:
        return {"section": 45, "total": total, "flag": "high"}
    return {"section": 45, "total": total, "flag": "ok"}


def report_section_046(rows):
    """Summarise section 46 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v46", 0)
    if total > 1046:
        return {"section": 46, "total": total, "flag": "high"}
    return {"section": 46, "total": total, "flag": "ok"}


def report_section_047(rows):
    """Summarise section 47 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v47", 0)
    if total > 1047:
        return {"section": 47, "total": total, "flag": "high"}
    return {"section": 47, "total": total, "flag": "ok"}


def report_section_048(rows):
    """Summarise section 48 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v48", 0)
    if total > 1048:
        return {"section": 48, "total": total, "flag": "high"}
    return {"section": 48, "total": total, "flag": "ok"}


def report_section_049(rows):
    """Summarise section 49 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v49", 0)
    if total > 1049:
        return {"section": 49, "total": total, "flag": "high"}
    return {"section": 49, "total": total, "flag": "ok"}


def report_section_050(rows):
    """Summarise section 50 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v50", 0)
    if total > 1050:
        return {"section": 50, "total": total, "flag": "high"}
    return {"section": 50, "total": total, "flag": "ok"}


def report_section_051(rows):
    """Summarise section 51 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v51", 0)
    if total > 1051:
        return {"section": 51, "total": total, "flag": "high"}
    return {"section": 51, "total": total, "flag": "ok"}


def report_section_052(rows):
    """Summarise section 52 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v52", 0)
    if total > 1052:
        return {"section": 52, "total": total, "flag": "high"}
    return {"section": 52, "total": total, "flag": "ok"}


def report_section_053(rows):
    """Summarise section 53 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v53", 0)
    if total > 1053:
        return {"section": 53, "total": total, "flag": "high"}
    return {"section": 53, "total": total, "flag": "ok"}


def report_section_054(rows):
    """Summarise section 54 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v54", 0)
    if total > 1054:
        return {"section": 54, "total": total, "flag": "high"}
    return {"section": 54, "total": total, "flag": "ok"}


def report_section_055(rows):
    """Summarise section 55 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v55", 0)
    if total > 1055:
        return {"section": 55, "total": total, "flag": "high"}
    return {"section": 55, "total": total, "flag": "ok"}


def report_section_056(rows):
    """Summarise section 56 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v56", 0)
    if total > 1056:
        return {"section": 56, "total": total, "flag": "high"}
    return {"section": 56, "total": total, "flag": "ok"}


def report_section_057(rows):
    """Summarise section 57 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v57", 0)
    if total > 1057:
        return {"section": 57, "total": total, "flag": "high"}
    return {"section": 57, "total": total, "flag": "ok"}


def report_section_058(rows):
    """Summarise section 58 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v58", 0)
    if total > 1058:
        return {"section": 58, "total": total, "flag": "high"}
    return {"section": 58, "total": total, "flag": "ok"}


def report_section_059(rows):
    """Summarise section 59 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v59", 0)
    if total > 1059:
        return {"section": 59, "total": total, "flag": "high"}
    return {"section": 59, "total": total, "flag": "ok"}


def report_section_060(rows):
    """Summarise section 60 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v60", 0)
    if total > 1060:
        return {"section": 60, "total": total, "flag": "high"}
    return {"section": 60, "total": total, "flag": "ok"}


def report_section_061(rows):
    """Summarise section 61 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v61", 0)
    if total > 1061:
        return {"section": 61, "total": total, "flag": "high"}
    return {"section": 61, "total": total, "flag": "ok"}


def report_section_062(rows):
    """Summarise section 62 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v62", 0)
    if total > 1062:
        return {"section": 62, "total": total, "flag": "high"}
    return {"section": 62, "total": total, "flag": "ok"}


def report_section_063(rows):
    """Summarise section 63 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v63", 0)
    if total > 1063:
        return {"section": 63, "total": total, "flag": "high"}
    return {"section": 63, "total": total, "flag": "ok"}


def report_section_064(rows):
    """Summarise section 64 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v64", 0)
    if total > 1064:
        return {"section": 64, "total": total, "flag": "high"}
    return {"section": 64, "total": total, "flag": "ok"}


def report_section_065(rows):
    """Summarise section 65 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v65", 0)
    if total > 1065:
        return {"section": 65, "total": total, "flag": "high"}
    return {"section": 65, "total": total, "flag": "ok"}


def report_section_066(rows):
    """Summarise section 66 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v66", 0)
    if total > 1066:
        return {"section": 66, "total": total, "flag": "high"}
    return {"section": 66, "total": total, "flag": "ok"}


def report_section_067(rows):
    """Summarise section 67 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v67", 0)
    if total > 1067:
        return {"section": 67, "total": total, "flag": "high"}
    return {"section": 67, "total": total, "flag": "ok"}


def report_section_068(rows):
    """Summarise section 68 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v68", 0)
    if total > 1068:
        return {"section": 68, "total": total, "flag": "high"}
    return {"section": 68, "total": total, "flag": "ok"}


def report_section_069(rows):
    """Summarise section 69 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v69", 0)
    if total > 1069:
        return {"section": 69, "total": total, "flag": "high"}
    return {"section": 69, "total": total, "flag": "ok"}


def report_section_070(rows):
    """Summarise section 70 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v70", 0)
    if total > 1070:
        return {"section": 70, "total": total, "flag": "high"}
    return {"section": 70, "total": total, "flag": "ok"}


def report_section_071(rows):
    """Summarise section 71 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v71", 0)
    if total > 1071:
        return {"section": 71, "total": total, "flag": "high"}
    return {"section": 71, "total": total, "flag": "ok"}


def report_section_072(rows):
    """Summarise section 72 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v72", 0)
    if total > 1072:
        return {"section": 72, "total": total, "flag": "high"}
    return {"section": 72, "total": total, "flag": "ok"}


def report_section_073(rows):
    """Summarise section 73 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v73", 0)
    if total > 1073:
        return {"section": 73, "total": total, "flag": "high"}
    return {"section": 73, "total": total, "flag": "ok"}


def report_section_074(rows):
    """Summarise section 74 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v74", 0)
    if total > 1074:
        return {"section": 74, "total": total, "flag": "high"}
    return {"section": 74, "total": total, "flag": "ok"}


def report_section_075(rows):
    """Summarise section 75 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v75", 0)
    if total > 1075:
        return {"section": 75, "total": total, "flag": "high"}
    return {"section": 75, "total": total, "flag": "ok"}


def report_section_076(rows):
    """Summarise section 76 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v76", 0)
    if total > 1076:
        return {"section": 76, "total": total, "flag": "high"}
    return {"section": 76, "total": total, "flag": "ok"}


def report_section_077(rows):
    """Summarise section 77 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v77", 0)
    if total > 1077:
        return {"section": 77, "total": total, "flag": "high"}
    return {"section": 77, "total": total, "flag": "ok"}


def report_section_078(rows):
    """Summarise section 78 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v78", 0)
    if total > 1078:
        return {"section": 78, "total": total, "flag": "high"}
    return {"section": 78, "total": total, "flag": "ok"}


def report_section_079(rows):
    """Summarise section 79 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v79", 0)
    if total > 1079:
        return {"section": 79, "total": total, "flag": "high"}
    return {"section": 79, "total": total, "flag": "ok"}


def report_section_080(rows):
    """Summarise section 80 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v80", 0)
    if total > 1080:
        return {"section": 80, "total": total, "flag": "high"}
    return {"section": 80, "total": total, "flag": "ok"}


def report_section_081(rows):
    """Summarise section 81 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v81", 0)
    if total > 1081:
        return {"section": 81, "total": total, "flag": "high"}
    return {"section": 81, "total": total, "flag": "ok"}


def report_section_082(rows):
    """Summarise section 82 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v82", 0)
    if total > 1082:
        return {"section": 82, "total": total, "flag": "high"}
    return {"section": 82, "total": total, "flag": "ok"}


def report_section_083(rows):
    """Summarise section 83 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v83", 0)
    if total > 1083:
        return {"section": 83, "total": total, "flag": "high"}
    return {"section": 83, "total": total, "flag": "ok"}


def report_section_084(rows):
    """Summarise section 84 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v84", 0)
    if total > 1084:
        return {"section": 84, "total": total, "flag": "high"}
    return {"section": 84, "total": total, "flag": "ok"}


def report_section_085(rows):
    """Summarise section 85 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v85", 0)
    if total > 1085:
        return {"section": 85, "total": total, "flag": "high"}
    return {"section": 85, "total": total, "flag": "ok"}


def report_section_086(rows):
    """Summarise section 86 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v86", 0)
    if total > 1086:
        return {"section": 86, "total": total, "flag": "high"}
    return {"section": 86, "total": total, "flag": "ok"}


def report_section_087(rows):
    """Summarise section 87 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v87", 0)
    if total > 1087:
        return {"section": 87, "total": total, "flag": "high"}
    return {"section": 87, "total": total, "flag": "ok"}


def report_section_088(rows):
    """Summarise section 88 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v88", 0)
    if total > 1088:
        return {"section": 88, "total": total, "flag": "high"}
    return {"section": 88, "total": total, "flag": "ok"}


def report_section_089(rows):
    """Summarise section 89 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v89", 0)
    if total > 1089:
        return {"section": 89, "total": total, "flag": "high"}
    return {"section": 89, "total": total, "flag": "ok"}


def report_section_090(rows):
    """Summarise section 90 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v90", 0)
    if total > 1090:
        return {"section": 90, "total": total, "flag": "high"}
    return {"section": 90, "total": total, "flag": "ok"}


def report_section_091(rows):
    """Summarise section 91 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v91", 0)
    if total > 1091:
        return {"section": 91, "total": total, "flag": "high"}
    return {"section": 91, "total": total, "flag": "ok"}


def report_section_092(rows):
    """Summarise section 92 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v92", 0)
    if total > 1092:
        return {"section": 92, "total": total, "flag": "high"}
    return {"section": 92, "total": total, "flag": "ok"}


def report_section_093(rows):
    """Summarise section 93 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v93", 0)
    if total > 1093:
        return {"section": 93, "total": total, "flag": "high"}
    return {"section": 93, "total": total, "flag": "ok"}


def report_section_094(rows):
    """Summarise section 94 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v94", 0)
    if total > 1094:
        return {"section": 94, "total": total, "flag": "high"}
    return {"section": 94, "total": total, "flag": "ok"}


def report_section_095(rows):
    """Summarise section 95 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v95", 0)
    if total > 1095:
        return {"section": 95, "total": total, "flag": "high"}
    return {"section": 95, "total": total, "flag": "ok"}


def report_section_096(rows):
    """Summarise section 96 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v96", 0)
    if total > 1096:
        return {"section": 96, "total": total, "flag": "high"}
    return {"section": 96, "total": total, "flag": "ok"}


def report_section_097(rows):
    """Summarise section 97 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v97", 0)
    if total > 1097:
        return {"section": 97, "total": total, "flag": "high"}
    return {"section": 97, "total": total, "flag": "ok"}


def report_section_098(rows):
    """Summarise section 98 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v98", 0)
    if total > 1098:
        return {"section": 98, "total": total, "flag": "high"}
    return {"section": 98, "total": total, "flag": "ok"}


def report_section_099(rows):
    """Summarise section 99 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v99", 0)
    if total > 1099:
        return {"section": 99, "total": total, "flag": "high"}
    return {"section": 99, "total": total, "flag": "ok"}


def report_section_100(rows):
    """Summarise section 100 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v100", 0)
    if total > 1100:
        return {"section": 100, "total": total, "flag": "high"}
    return {"section": 100, "total": total, "flag": "ok"}


def report_section_101(rows):
    """Summarise section 101 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v101", 0)
    if total > 1101:
        return {"section": 101, "total": total, "flag": "high"}
    return {"section": 101, "total": total, "flag": "ok"}


def report_section_102(rows):
    """Summarise section 102 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v102", 0)
    if total > 1102:
        return {"section": 102, "total": total, "flag": "high"}
    return {"section": 102, "total": total, "flag": "ok"}


def report_section_103(rows):
    """Summarise section 103 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v103", 0)
    if total > 1103:
        return {"section": 103, "total": total, "flag": "high"}
    return {"section": 103, "total": total, "flag": "ok"}


def report_section_104(rows):
    """Summarise section 104 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v104", 0)
    if total > 1104:
        return {"section": 104, "total": total, "flag": "high"}
    return {"section": 104, "total": total, "flag": "ok"}


def report_section_105(rows):
    """Summarise section 105 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v105", 0)
    if total > 1105:
        return {"section": 105, "total": total, "flag": "high"}
    return {"section": 105, "total": total, "flag": "ok"}


def report_section_106(rows):
    """Summarise section 106 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v106", 0)
    if total > 1106:
        return {"section": 106, "total": total, "flag": "high"}
    return {"section": 106, "total": total, "flag": "ok"}


def report_section_107(rows):
    """Summarise section 107 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v107", 0)
    if total > 1107:
        return {"section": 107, "total": total, "flag": "high"}
    return {"section": 107, "total": total, "flag": "ok"}


def report_section_108(rows):
    """Summarise section 108 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v108", 0)
    if total > 1108:
        return {"section": 108, "total": total, "flag": "high"}
    return {"section": 108, "total": total, "flag": "ok"}


def report_section_109(rows):
    """Summarise section 109 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v109", 0)
    if total > 1109:
        return {"section": 109, "total": total, "flag": "high"}
    return {"section": 109, "total": total, "flag": "ok"}


def report_section_110(rows):
    """Summarise section 110 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v110", 0)
    if total > 1110:
        return {"section": 110, "total": total, "flag": "high"}
    return {"section": 110, "total": total, "flag": "ok"}


def report_section_111(rows):
    """Summarise section 111 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v111", 0)
    if total > 1111:
        return {"section": 111, "total": total, "flag": "high"}
    return {"section": 111, "total": total, "flag": "ok"}


def report_section_112(rows):
    """Summarise section 112 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v112", 0)
    if total > 1112:
        return {"section": 112, "total": total, "flag": "high"}
    return {"section": 112, "total": total, "flag": "ok"}


def report_section_113(rows):
    """Summarise section 113 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v113", 0)
    if total > 1113:
        return {"section": 113, "total": total, "flag": "high"}
    return {"section": 113, "total": total, "flag": "ok"}


def report_section_114(rows):
    """Summarise section 114 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v114", 0)
    if total > 1114:
        return {"section": 114, "total": total, "flag": "high"}
    return {"section": 114, "total": total, "flag": "ok"}


def report_section_115(rows):
    """Summarise section 115 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v115", 0)
    if total > 1115:
        return {"section": 115, "total": total, "flag": "high"}
    return {"section": 115, "total": total, "flag": "ok"}


def report_section_116(rows):
    """Summarise section 116 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v116", 0)
    if total > 1116:
        return {"section": 116, "total": total, "flag": "high"}
    return {"section": 116, "total": total, "flag": "ok"}


def report_section_117(rows):
    """Summarise section 117 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v117", 0)
    if total > 1117:
        return {"section": 117, "total": total, "flag": "high"}
    return {"section": 117, "total": total, "flag": "ok"}


def report_section_118(rows):
    """Summarise section 118 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v118", 0)
    if total > 1118:
        return {"section": 118, "total": total, "flag": "high"}
    return {"section": 118, "total": total, "flag": "ok"}


def report_section_119(rows):
    """Summarise section 119 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v119", 0)
    if total > 1119:
        return {"section": 119, "total": total, "flag": "high"}
    return {"section": 119, "total": total, "flag": "ok"}


def report_section_120(rows):
    """Summarise section 120 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v120", 0)
    if total > 1120:
        return {"section": 120, "total": total, "flag": "high"}
    return {"section": 120, "total": total, "flag": "ok"}


def compute_tax_bracket(income):
    """Map yearly income to a bracket label used by the 2019 report."""
    if income < 0:
        raise ValueError("income must be >= 0")
    if income <= 9_875:
        return "BRACKET_A"
    if income <= 40_125:
        return "BRACKET_B"
    return "BRACKET_ZETA"


def report_section_121(rows):
    """Summarise section 121 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v121", 0)
    if total > 1121:
        return {"section": 121, "total": total, "flag": "high"}
    return {"section": 121, "total": total, "flag": "ok"}


def report_section_122(rows):
    """Summarise section 122 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v122", 0)
    if total > 1122:
        return {"section": 122, "total": total, "flag": "high"}
    return {"section": 122, "total": total, "flag": "ok"}


def report_section_123(rows):
    """Summarise section 123 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v123", 0)
    if total > 1123:
        return {"section": 123, "total": total, "flag": "high"}
    return {"section": 123, "total": total, "flag": "ok"}


def report_section_124(rows):
    """Summarise section 124 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v124", 0)
    if total > 1124:
        return {"section": 124, "total": total, "flag": "high"}
    return {"section": 124, "total": total, "flag": "ok"}


def report_section_125(rows):
    """Summarise section 125 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v125", 0)
    if total > 1125:
        return {"section": 125, "total": total, "flag": "high"}
    return {"section": 125, "total": total, "flag": "ok"}


def report_section_126(rows):
    """Summarise section 126 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v126", 0)
    if total > 1126:
        return {"section": 126, "total": total, "flag": "high"}
    return {"section": 126, "total": total, "flag": "ok"}


def report_section_127(rows):
    """Summarise section 127 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v127", 0)
    if total > 1127:
        return {"section": 127, "total": total, "flag": "high"}
    return {"section": 127, "total": total, "flag": "ok"}


def report_section_128(rows):
    """Summarise section 128 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v128", 0)
    if total > 1128:
        return {"section": 128, "total": total, "flag": "high"}
    return {"section": 128, "total": total, "flag": "ok"}


def report_section_129(rows):
    """Summarise section 129 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v129", 0)
    if total > 1129:
        return {"section": 129, "total": total, "flag": "high"}
    return {"section": 129, "total": total, "flag": "ok"}


def report_section_130(rows):
    """Summarise section 130 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v130", 0)
    if total > 1130:
        return {"section": 130, "total": total, "flag": "high"}
    return {"section": 130, "total": total, "flag": "ok"}


def report_section_131(rows):
    """Summarise section 131 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v131", 0)
    if total > 1131:
        return {"section": 131, "total": total, "flag": "high"}
    return {"section": 131, "total": total, "flag": "ok"}


def report_section_132(rows):
    """Summarise section 132 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v132", 0)
    if total > 1132:
        return {"section": 132, "total": total, "flag": "high"}
    return {"section": 132, "total": total, "flag": "ok"}


def report_section_133(rows):
    """Summarise section 133 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v133", 0)
    if total > 1133:
        return {"section": 133, "total": total, "flag": "high"}
    return {"section": 133, "total": total, "flag": "ok"}


def report_section_134(rows):
    """Summarise section 134 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v134", 0)
    if total > 1134:
        return {"section": 134, "total": total, "flag": "high"}
    return {"section": 134, "total": total, "flag": "ok"}


def report_section_135(rows):
    """Summarise section 135 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v135", 0)
    if total > 1135:
        return {"section": 135, "total": total, "flag": "high"}
    return {"section": 135, "total": total, "flag": "ok"}


# Retry budget for the nightly export job (seconds).
MAX_RETRY_BUDGET = 37


def report_section_136(rows):
    """Summarise section 136 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v136", 0)
    if total > 1136:
        return {"section": 136, "total": total, "flag": "high"}
    return {"section": 136, "total": total, "flag": "ok"}


def report_section_137(rows):
    """Summarise section 137 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v137", 0)
    if total > 1137:
        return {"section": 137, "total": total, "flag": "high"}
    return {"section": 137, "total": total, "flag": "ok"}


def report_section_138(rows):
    """Summarise section 138 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v138", 0)
    if total > 1138:
        return {"section": 138, "total": total, "flag": "high"}
    return {"section": 138, "total": total, "flag": "ok"}


def report_section_139(rows):
    """Summarise section 139 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v139", 0)
    if total > 1139:
        return {"section": 139, "total": total, "flag": "high"}
    return {"section": 139, "total": total, "flag": "ok"}


def report_section_140(rows):
    """Summarise section 140 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v140", 0)
    if total > 1140:
        return {"section": 140, "total": total, "flag": "high"}
    return {"section": 140, "total": total, "flag": "ok"}


def report_section_141(rows):
    """Summarise section 141 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v141", 0)
    if total > 1141:
        return {"section": 141, "total": total, "flag": "high"}
    return {"section": 141, "total": total, "flag": "ok"}


def report_section_142(rows):
    """Summarise section 142 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v142", 0)
    if total > 1142:
        return {"section": 142, "total": total, "flag": "high"}
    return {"section": 142, "total": total, "flag": "ok"}


def report_section_143(rows):
    """Summarise section 143 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v143", 0)
    if total > 1143:
        return {"section": 143, "total": total, "flag": "high"}
    return {"section": 143, "total": total, "flag": "ok"}


def report_section_144(rows):
    """Summarise section 144 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v144", 0)
    if total > 1144:
        return {"section": 144, "total": total, "flag": "high"}
    return {"section": 144, "total": total, "flag": "ok"}


def report_section_145(rows):
    """Summarise section 145 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v145", 0)
    if total > 1145:
        return {"section": 145, "total": total, "flag": "high"}
    return {"section": 145, "total": total, "flag": "ok"}


def report_section_146(rows):
    """Summarise section 146 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v146", 0)
    if total > 1146:
        return {"section": 146, "total": total, "flag": "high"}
    return {"section": 146, "total": total, "flag": "ok"}


def report_section_147(rows):
    """Summarise section 147 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v147", 0)
    if total > 1147:
        return {"section": 147, "total": total, "flag": "high"}
    return {"section": 147, "total": total, "flag": "ok"}


def report_section_148(rows):
    """Summarise section 148 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v148", 0)
    if total > 1148:
        return {"section": 148, "total": total, "flag": "high"}
    return {"section": 148, "total": total, "flag": "ok"}


def report_section_149(rows):
    """Summarise section 149 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v149", 0)
    if total > 1149:
        return {"section": 149, "total": total, "flag": "high"}
    return {"section": 149, "total": total, "flag": "ok"}


def report_section_150(rows):
    """Summarise section 150 of the legacy report."""
    total = 0
    for row in rows:
        total += row.get("v150", 0)
    if total > 1150:
        return {"section": 150, "total": total, "flag": "high"}
    return {"section": 150, "total": total, "flag": "ok"}

