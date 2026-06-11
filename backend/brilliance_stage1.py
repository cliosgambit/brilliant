"""
Brilliance Engine — Stage 1 sacrifice classification.
Runs only on Stage 0 sacrifice candidates. No engine (Stockfish enters at Stage 2).

Philosophy: filter only obvious nonsense; let Stages 2–3 decide brilliance.
"""
import io
import json
import sys

import chess
import chess.pgn

from brilliance_stage0 import (
    PIECE_VALUES,
    analyze_piece_vulnerability,
    expectation_violation,
    is_sacrifice_candidate,
    king_safety,
    piece_harmony,
    quiet_brilliant_detector,
    see,
    tactical_multiplexing,
)

HARD_DISQUALIFIERS = frozenset({"winning_capture_not_sacrifice"})
SACRIFICE_UNCERTAINTY_CAP = 25.0


def _variance(values):
    if len(values) <= 1:
        return 0.0
    mean = sum(values) / len(values)
    return sum((x - mean) ** 2 for x in values) / len(values)


def _sacrifice_uncertainty(scenarios):
    if len(scenarios) <= 1:
        return 0.0
    normalized = [x / 100.0 for x in scenarios]
    return round(min(_variance(normalized), SACRIFICE_UNCERTAINTY_CAP), 2)


def is_recapture(board, move):
    """Previous move landed on the same square this capture targets (telemetry only)."""
    if not board.is_capture(move) or not board.move_stack:
        return False
    last_move = board.peek()
    return last_move.to_square == move.to_square


def _move_context(board, move, color):
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
    }


def compute_dynamic_score(ctx):
    king_pressure = max(0.0, -ctx["opp_king_safety_delta"])
    return (
        king_pressure * 0.4
        + ctx["multiplexing_score"] * 0.8
        + ctx["quiet_score"] * 0.5
        + ctx["harmony_score"] * 0.3
    )


def tactical_bypass(ctx):
    return (
        ctx["move_gives_check"]
        or ctx["multiplexing_score"] >= 6
        or ctx["opp_king_safety_delta"] <= -60
    )


def _infer_sac_type(board, move, color, see_value, is_pseudo, cap_val, if_val, moving_piece):
    if moving_piece and moving_piece.piece_type == chess.QUEEN:
        return "queen_sacrifice"
    if moving_piece and moving_piece.piece_type == chess.ROOK and cap_val < 400:
        return "exchange_sacrifice"
    if not board.is_capture(move):
        return "positional_piece_placement"
    if see_value < -300:
        return "real_sacrifice"
    if is_pseudo:
        return "pseudo_sacrifice"
    return "tactical_sacrifice"


def classify_sacrifice_type(board, move, color, see_value=0):
    to_sq = move.to_square
    from_sq = move.from_square
    moving_piece = board.piece_at(from_sq)
    captured = board.piece_at(to_sq)

    if_val = PIECE_VALUES.get(moving_piece.piece_type, 0) if moving_piece else 0
    cap_val = PIECE_VALUES.get(captured.piece_type, 0) if captured else 0

    board_after = board.copy()
    board_after.push(move)
    recaptures = [m for m in board_after.legal_moves if m.to_square == to_sq]
    is_pseudo = (
        len(recaptures) > 0
        and cap_val > 0
        and cap_val >= if_val * 0.8
    )

    sac_type = _infer_sac_type(
        board, move, color, see_value, is_pseudo, cap_val, if_val, moving_piece
    )
    is_exchange_sac = sac_type == "exchange_sacrifice"

    disqualifiers = []

    if board.is_capture(move):
        if see_value >= 150:
            disqualifiers.append("winning_capture_not_sacrifice")
        elif see_value >= -100 and not is_exchange_sac:
            disqualifiers.append("equal_trade_not_sacrifice")

    if board.is_capture(move) and captured:
        our_attackers = [
            m
            for m in board.generate_pseudo_legal_moves()
            if m.to_square == to_sq
            and board.piece_at(m.from_square)
            and board.piece_at(m.from_square).color == color
            and board.is_legal(m)
        ]
        if our_attackers:
            lva_m = min(
                our_attackers,
                key=lambda m: PIECE_VALUES.get(
                    board.piece_at(m.from_square).piece_type, 0
                ),
            )
            lva_see = see(board, lva_m)
            lva_piece_val = PIECE_VALUES.get(
                board.piece_at(lva_m.from_square).piece_type, 0
            )
            if lva_see > 0 and if_val == lva_piece_val and not is_exchange_sac:
                disqualifiers.append("cheapest_attacker_wins_material")

    vuln = analyze_piece_vulnerability(board, from_sq, color)
    if vuln["already_lost_before_move"]:
        disqualifiers.append(
            vuln.get("disqualify_reason") or "piece_already_lost_before_move"
        )

    scenarios = [see_value if board.is_capture(move) else cap_val - if_val]
    for rc in recaptures[:5]:
        b2 = board_after.copy()
        b2.push(rc)
        p_left = b2.piece_at(to_sq)
        val_diff = PIECE_VALUES.get(p_left.piece_type, 0) - if_val if p_left else -if_val
        scenarios.append(val_diff)

    return {
        "sac_type": sac_type,
        "disqualifiers": disqualifiers,
        "is_valid_sacrifice": len(disqualifiers) == 0,
        "is_pseudo": is_pseudo,
        "is_recapture": is_recapture(board, move),
        "material_loss_cp": see_value if board.is_capture(move) else 0,
        "sacrifice_uncertainty": _sacrifice_uncertainty(scenarios),
        "recapture_options": len(recaptures),
        "piece_vulnerability": vuln,
    }


def is_forced_move(board, move):
    total_legal = list(board.legal_moves)
    n_moves = len(total_legal)

    if n_moves == 1:
        return {"is_forced": True, "reason": "only_legal_move", "n_legal": n_moves}

    return {"is_forced": False, "reason": None, "n_legal": n_moves}


def _should_proceed_to_stage2(stage0, sac_class, forced, ctx):
    if forced["is_forced"]:
        return False, "only_legal_move"

    disqualifiers = sac_class.get("disqualifiers") or []
    if HARD_DISQUALIFIERS.intersection(disqualifiers):
        return False, disqualifiers[0]

    if sac_class.get("is_valid_sacrifice"):
        return True, None

    see_value = stage0.get("see_value") or 0
    sac_type = sac_class.get("sac_type")
    dynamic = compute_dynamic_score(ctx)
    tactical = tactical_bypass(ctx)
    exchange_override = sac_type == "exchange_sacrifice" and see_value <= -50

    if tactical or dynamic >= 6 or exchange_override:
        if "piece_already_lost_before_move" in disqualifiers and not tactical:
            return False, disqualifiers[0]
        reason = "tactical_bypass" if tactical else (
            "dynamic_compensation_override" if dynamic >= 6 else "exchange_sacrifice_override"
        )
        return True, reason

    if disqualifiers:
        return False, disqualifiers[0]

    return True, None


def analyze_stage1_move(board, move, ply_index):
    color = board.turn
    stage0 = is_sacrifice_candidate(board, move, color)

    if not stage0["is_sacrifice_candidate"]:
        return None

    ctx = _move_context(board, move, color)
    sac_class = classify_sacrifice_type(
        board, move, color, see_value=stage0.get("see_value") or 0
    )
    forced = is_forced_move(board, move)

    proceed_to_stage2, override_reason = _should_proceed_to_stage2(
        stage0, sac_class, forced, ctx
    )

    gate_fail_reason = None
    if not proceed_to_stage2:
        gate_fail_reason = override_reason or forced.get("reason")

    return {
        "ply_index": ply_index,
        "san_move": board.san(move),
        "uci_move": move.uci(),
        "turn": "white" if color == chess.WHITE else "black",
        "stage0": stage0,
        "sacrifice_class": sac_class,
        "forced": forced,
        "is_valid_sacrifice": sac_class["is_valid_sacrifice"],
        "is_forced": forced["is_forced"],
        "proceed_to_stage2": proceed_to_stage2,
        "gate_fail_reason": gate_fail_reason,
        "stage1_context": ctx,
        "dynamic_score": round(compute_dynamic_score(ctx), 2),
        "tactical_bypass": tactical_bypass(ctx),
        "proceed_override_reason": override_reason if proceed_to_stage2 and not sac_class["is_valid_sacrifice"] else None,
        "engine_used": False,
    }


def analyze_pgn_stage1(pgn_text):
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        raise ValueError("Could not parse PGN")

    board = game.board()
    candidates = []

    for ply_index, move in enumerate(game.mainline_moves()):
        result = analyze_stage1_move(board, move, ply_index)
        if result:
            candidates.append(result)
        board.push(move)

    valid_count = sum(1 for c in candidates if c["is_valid_sacrifice"])
    proceed_count = sum(1 for c in candidates if c["proceed_to_stage2"])
    forced_count = sum(1 for c in candidates if c["is_forced"])

    return {
        "engine_used": False,
        "candidate_count": len(candidates),
        "valid_sacrifice_count": valid_count,
        "proceed_to_stage2_count": proceed_count,
        "forced_move_count": forced_count,
        "disqualified_count": len(candidates) - valid_count,
        "moves": candidates,
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "input_json is required"}))
        return 1

    try:
        payload = json.loads(sys.argv[1])
    except Exception as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}))
        return 1

    pgn = payload.get("pgn") or payload.get("clean_pgn")
    if not pgn:
        print(json.dumps({"error": "pgn is required"}))
        return 1

    try:
        result = analyze_pgn_stage1(pgn)
        print(json.dumps(result))
        return 0
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
