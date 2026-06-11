"""
Brilliance Engine — Stage 3 deep Stockfish validation.
Runs only on Stage 2 proceed_to_stage3 moves. Depth curve d5–18, rank d8/d18, defense d18.
All stored cp scores use white POV (+ = white better).
"""
import io
import json
import os
import sys

import chess
import chess.engine
import chess.pgn

from brilliance_eval import (
    EVAL_PERSPECTIVE,
    STAGE3_DEPTH_CURVE_TIME_S,
    STAGE3_SEARCH_TIME_S,
    cp_from_info_white,
    cp_to_ep,
    cpl_from_white_scores,
    engine_limit,
    linear_slope,
    to_mover_cp,
    variance,
)
from brilliance_stage2 import analyze_stage2_move

STOCKFISH_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "stockfish", "stockfish-windows-x86-64-avx2.exe")
)

DEPTH_CURVE = [5, 10, 15, 18]


def deep_engine_features(board_before, move, color, engine):
    board_after = board_before.copy()
    board_after.push(move)

    depth_evals_white = []
    for d in DEPTH_CURVE:
        info = engine.analyse(
            board_after,
            engine_limit(depth=d, time_s=STAGE3_DEPTH_CURVE_TIME_S),
        )
        depth_evals_white.append(cp_from_info_white(info))

    depth_evals_mover = [to_mover_cp(cp, color) for cp in depth_evals_white]

    depth_slope = linear_slope(DEPTH_CURVE, depth_evals_mover)
    depth_variance = variance(depth_evals_mover)
    early_avg = sum(depth_evals_mover[:2]) / 2
    late_avg = sum(depth_evals_mover[-2:]) / 2
    is_rising_curve = early_avg < 0 and late_avg > 0
    depth_gain = late_avg - early_avg

    deep_eval_white = depth_evals_white[-1]
    deep_eval_mover = to_mover_cp(deep_eval_white, color)
    is_sound = deep_eval_mover is not None and deep_eval_mover >= -30

    shallow_multi = engine.analyse(
        board_before,
        engine_limit(depth=8, time_s=STAGE3_SEARCH_TIME_S),
        multipv=10,
    )
    deep_multi = engine.analyse(
        board_before,
        engine_limit(depth=18, time_s=STAGE3_SEARCH_TIME_S),
        multipv=5,
    )
    if not isinstance(shallow_multi, list):
        shallow_multi = [shallow_multi]
    if not isinstance(deep_multi, list):
        deep_multi = [deep_multi]

    rank_shallow = 99
    rank_deep = 99
    for i, info in enumerate(shallow_multi):
        if info.get("pv") and info["pv"][0] == move:
            rank_shallow = i + 1
            break
    for i, info in enumerate(deep_multi):
        if info.get("pv") and info["pv"][0] == move:
            rank_deep = i + 1
            break

    rank_jump = rank_shallow - rank_deep
    is_non_obvious = rank_shallow >= 5 and rank_deep <= 2

    opp_results = engine.analyse(
        board_after,
        engine_limit(depth=18, time_s=STAGE3_SEARCH_TIME_S),
        multipv=8,
    )
    if not isinstance(opp_results, list):
        opp_results = [opp_results]

    opp_best = cp_from_info_white(opp_results[0])
    good_defenses = sum(
        1
        for r in opp_results
        if abs((opp_best or 0) - (cp_from_info_white(r) or 0)) <= 100
    )
    defense_difficulty = 1.0 - (good_defenses / max(1, len(opp_results)))

    best_alt_move = None
    if deep_multi[0].get("pv") and deep_multi[0]["pv"][0] != move:
        best_alt_move = deep_multi[0]["pv"][0]
    elif len(deep_multi) > 1 and deep_multi[1].get("pv"):
        best_alt_move = deep_multi[1]["pv"][0]

    best_deep_white = cp_from_info_white(deep_multi[0])
    cpl_deep = cpl_from_white_scores(best_deep_white, deep_eval_white, color)
    is_near_best_deep = cpl_deep <= 50

    counterfactual_delta = 0.0
    if best_alt_move:
        b_alt = board_before.copy()
        b_alt.push(best_alt_move)
        alt_info = engine.analyse(
            b_alt,
            engine_limit(depth=18, time_s=STAGE3_SEARCH_TIME_S),
        )
        alt_white = cp_from_info_white(alt_info)
        played_mover = to_mover_cp(deep_eval_white, color)
        alt_mover = to_mover_cp(alt_white, color)
        if played_mover is not None and alt_mover is not None:
            counterfactual_delta = played_mover - alt_mover

    non_obvious_score = (
        (1 if is_rising_curve else 0) * 3
        + (min(depth_gain, 500) / 500) * 3
        + (min(max(rank_jump, 0), 8) / 8) * 2
        + (1 if is_non_obvious else 0) * 2
    )

    return {
        "depth_evals": {str(d): e for d, e in zip(DEPTH_CURVE, depth_evals_white)},
        "depth_evals_mover": {str(d): e for d, e in zip(DEPTH_CURVE, depth_evals_mover)},
        "depth_slope": round(depth_slope, 2),
        "depth_variance": round(depth_variance, 1),
        "early_eval_avg": round(early_avg, 1),
        "late_eval_avg": round(late_avg, 1),
        "depth_gain": round(depth_gain, 1),
        "is_rising_curve": is_rising_curve,
        "deep_eval_cp": deep_eval_white,
        "deep_eval_mover_cp": deep_eval_mover,
        "deep_ep_mover": round(cp_to_ep(deep_eval_mover), 3),
        "cpl_deep": cpl_deep,
        "is_near_best_deep": is_near_best_deep,
        "is_sound": is_sound,
        "rank_at_depth8": rank_shallow,
        "rank_at_depth22": rank_deep,
        "rank_jump": rank_jump,
        "is_non_obvious": is_non_obvious,
        "good_defenses": good_defenses,
        "defense_difficulty": round(defense_difficulty, 3),
        "counterfactual_delta": round(counterfactual_delta, 1),
        "non_obvious_score": round(non_obvious_score, 2),
        "engine_depth": 18,
        "search_movetime_s": STAGE3_SEARCH_TIME_S,
        "depth_curve_movetime_s": STAGE3_DEPTH_CURVE_TIME_S,
        "engine_used": True,
        "eval_perspective": EVAL_PERSPECTIVE,
    }


def apply_stage3_gate(engine_features):
    unsound_reasons = []
    if not engine_features.get("is_sound"):
        unsound_reasons.append("deep_eval_below_threshold")
    if not engine_features.get("is_near_best_deep"):
        unsound_reasons.append("cpl_deep_too_high")

    if not unsound_reasons:
        return {
            "proceed_to_stage4": True,
            "classification_if_unsound": None,
            "gate_fail_reason": None,
        }
    return {
        "proceed_to_stage4": False,
        "classification_if_unsound": "speculative_sacrifice",
        "unsound_reasons": unsound_reasons,
        "gate_fail_reason": unsound_reasons[0],
    }


def analyze_stage3_move(board, move, ply_index, engine, skip_stage2_gate=False):
    color = board.turn

    if not skip_stage2_gate:
        stage2 = analyze_stage2_move(board, move, ply_index, engine)
        if not stage2 or not stage2["proceed_to_stage3"]:
            return None
        stage2_summary = {
            "cpl_shallow": stage2["engine"]["cpl_shallow"],
            "proceed_to_stage3": True,
        }
    else:
        stage2_summary = {"proceed_to_stage3": True}

    engine_feats = deep_engine_features(board, move, color, engine)
    gate = apply_stage3_gate(engine_feats)

    return {
        "ply_index": ply_index,
        "san_move": board.san(move),
        "uci_move": move.uci(),
        "turn": "white" if color == chess.WHITE else "black",
        "stage2": stage2_summary,
        "engine": engine_feats,
        "proceed_to_stage4": gate["proceed_to_stage4"],
        "classification_if_unsound": gate["classification_if_unsound"],
        "gate_fail_reason": gate.get("gate_fail_reason"),
        "engine_used": True,
    }


def analyze_pgn_stage3(pgn_text, engine_path=None, ply_indices=None):
    path = engine_path or STOCKFISH_PATH
    if not os.path.exists(path):
        raise FileNotFoundError(f"Stockfish not found at {path}")

    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        raise ValueError("Could not parse PGN")

    ply_set = set(ply_indices) if ply_indices is not None else None
    skip_stage2 = ply_set is not None

    moves_out = []

    with chess.engine.SimpleEngine.popen_uci(path) as engine:
        try:
            engine.configure({"Threads": 1, "Hash": 256, "MultiPV": 10})
        except chess.engine.EngineError:
            pass

        board = game.board()
        for ply_index, move in enumerate(game.mainline_moves()):
            if ply_set is not None and ply_index not in ply_set:
                board.push(move)
                continue

            result = analyze_stage3_move(
                board, move, ply_index, engine, skip_stage2_gate=skip_stage2
            )
            if result:
                result["engine"]["stockfish_path"] = path
                moves_out.append(result)
            board.push(move)

    sound_count = sum(1 for m in moves_out if m["engine"]["is_sound"])
    unsound_count = len(moves_out) - sound_count

    return {
        "engine_used": True,
        "stockfish_path": path,
        "eval_perspective": EVAL_PERSPECTIVE,
        "analyzed_count": len(moves_out),
        "sound_count": sound_count,
        "unsound_count": unsound_count,
        "rising_curve_count": sum(1 for m in moves_out if m["engine"]["is_rising_curve"]),
        "non_obvious_count": sum(1 for m in moves_out if m["engine"]["is_non_obvious"]),
        "moves": moves_out,
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

    engine_path = payload.get("engine_path") or STOCKFISH_PATH
    ply_indices = payload.get("ply_indices")

    try:
        result = analyze_pgn_stage3(pgn, engine_path, ply_indices)
        print(json.dumps(result))
        return 0
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
