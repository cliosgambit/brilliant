"""
Cascade gate logic — single source of truth for stage-to-stage move filtering.
Stage 1 filters obvious nonsense; Stages 2–3 decide brilliance.
"""
import chess

from brilliance_stage0 import (
    defensive_context,
    expectation_violation,
    is_sacrifice_candidate,
    king_safety,
    quiet_brilliant_detector,
    tactical_multiplexing,
    piece_harmony,
)
from brilliance_stage1 import analyze_stage1_move

QUIET_DIRECT_THRESHOLD = 4.5
ALT_QUIET_THRESHOLD = 4.0


def _move_brilliance_context(board, move, color):
    board_after = board.copy()
    board_after.push(move)
    tm = tactical_multiplexing(board, board_after, color)
    harmony = piece_harmony(board, board_after, color)
    quiet = quiet_brilliant_detector(board, move, color)
    ev = expectation_violation(board, move, color)
    ks_before = king_safety(board, not color)
    ks_after = king_safety(board_after, not color)
    return {
        "multiplexing_score": tm["multiplexing_score"],
        "harmony_score": harmony["harmony_score"],
        "quiet_score": quiet["quiet_score"],
        "ev_score": ev["ev_score"],
        "opp_king_safety_delta": ks_after["total_safety"] - ks_before["total_safety"],
        "move_gives_check": board_after.is_check(),
        "quiet": quiet,
        "tm": tm,
    }


def defensive_engine_candidate(board, move, color):
    """
    Defensive branch — when defending AND the move shows a defensive resource signal.
    """
    def_ctx = defensive_context(board, color)
    if not def_ctx["is_defending"]:
        return False

    board_after = board.copy()
    board_after.push(move)

    if board_after.is_check():
        return True

    from brilliance_stage4 import detect_perpetual_check, detect_stalemate_trap

    if detect_stalemate_trap(board, move, color).get("has_trap"):
        return True
    if detect_perpetual_check(board, move, color).get("has_perpetual"):
        return True

    quiet = quiet_brilliant_detector(board, move, color)
    if quiet["quiet_score"] > 2.0:
        return True

    return False


def _parallel_candidate(
    board,
    move,
    ply_index,
    color,
    sac_type,
    quiet=None,
    def_ctx=None,
    path="quiet",
    stage0=None,
    sacrifice_class=None,
    forced=None,
    extra=None,
):
    sac0 = stage0 if stage0 is not None else is_sacrifice_candidate(board, move, color)
    sac_cls = sacrifice_class or {
        "sac_type": sac_type,
        "is_valid_sacrifice": False,
        "disqualifiers": [],
    }
    forced_info = forced or {"is_forced": False, "reason": None}
    out = {
        "ply_index": ply_index,
        "san_move": board.san(move),
        "uci_move": move.uci(),
        "turn": "white" if color == chess.WHITE else "black",
        "stage0": sac0,
        "sacrifice_class": sac_cls,
        "forced": forced_info,
        "is_valid_sacrifice": sac_cls.get("is_valid_sacrifice", False),
        "is_forced": forced_info.get("is_forced", False),
        "proceed_to_stage2": True,
        "gate_fail_reason": None,
        "quiet": quiet or {},
        "defensive_context": def_ctx or {},
        "candidate_path": path,
        "engine_used": False,
    }
    if extra:
        out.update(extra)
    return out


def _alternative_eligible(ctx, sac0, sac_type):
    return (
        ctx["quiet"]["quiet_score"] >= ALT_QUIET_THRESHOLD
        or ctx["multiplexing_score"] >= 6
        or ctx["opp_king_safety_delta"] <= -60
        or ctx["ev_score"] >= 5
        or sac0.get("is_sacrifice_candidate")
        or (sac_type and sac_type != "unknown")
    )


def _blocks_alternative_path(stage1):
    if not stage1:
        return False
    if stage1.get("is_forced"):
        return True
    disq = (stage1.get("sacrifice_class") or {}).get("disqualifiers") or []
    if "winning_capture_not_sacrifice" in disq:
        return True
    if "piece_already_lost_before_move" in disq and not stage1.get("tactical_bypass"):
        return True
    return False


def resolve_engine_candidate(board, move, ply_index):
    """
    Stage 2 entry gate — permissive candidate filter.
    Paths: sacrifice (Stage 1), quiet (direct), alternative, defensive.
    """
    color = board.turn
    ctx = _move_brilliance_context(board, move, color)
    quiet = ctx["quiet"]

    if quiet["quiet_score"] >= QUIET_DIRECT_THRESHOLD:
        sac0 = is_sacrifice_candidate(board, move, color)
        return (
            _parallel_candidate(
                board,
                move,
                ply_index,
                color,
                "quiet_positional",
                quiet=quiet,
                path="quiet",
                stage0=sac0,
            ),
            "quiet",
        )

    stage1 = analyze_stage1_move(board, move, ply_index)
    if stage1 and stage1["proceed_to_stage2"]:
        stage1["candidate_path"] = "sacrifice"
        return stage1, "sacrifice"

    if _blocks_alternative_path(stage1):
        return None, None

    sac0 = (
        stage1["stage0"]
        if stage1
        else is_sacrifice_candidate(board, move, color)
    )
    sac_type = (
        (stage1.get("sacrifice_class") or {}).get("sac_type")
        if stage1
        else "unknown"
    )

    if not _alternative_eligible(ctx, sac0, sac_type):
        return None, None

    def_ctx = defensive_context(board, color)
    if defensive_engine_candidate(board, move, color):
        path = "defensive"
        label = "defensive_resource"
    else:
        path = "alternative"
        label = sac_type if sac_type != "unknown" else "tactical_resource"

    extra = {
        "stage1_context": {
            "multiplexing_score": ctx["multiplexing_score"],
            "ev_score": ctx["ev_score"],
            "opp_king_safety_delta": ctx["opp_king_safety_delta"],
            "quiet_score": ctx["quiet_score"],
        },
        "proceed_override_reason": "alternative_stage2_entry",
    }

    return (
        _parallel_candidate(
            board,
            move,
            ply_index,
            color,
            label,
            quiet=quiet,
            def_ctx=def_ctx,
            path=path,
            stage0=sac0,
            sacrifice_class=stage1.get("sacrifice_class") if stage1 else None,
            forced=stage1.get("forced") if stage1 else None,
            extra=extra,
        ),
        path,
    )


def compute_engine_candidacy(board, move, ply_index):
    """Stage 0 flags — reflects all paths that can reach Stage 2."""
    sac0 = is_sacrifice_candidate(board, move, color=board.turn)
    quiet = quiet_brilliant_detector(board, move, board.turn)
    def_ctx = defensive_context(board, board.turn)
    candidate, path = resolve_engine_candidate(board, move, ply_index)
    return {
        "is_sacrifice_candidate": sac0["is_sacrifice_candidate"],
        "proceed_to_stage1": sac0["is_sacrifice_candidate"],
        "proceed_to_engine": candidate is not None,
        "engine_candidate_path": path,
        "quiet_brilliance": quiet,
        "defensive_context": def_ctx,
    }
