"""
Brilliance Engine — Stage 2 shallow Stockfish validation.
Runs only on Stage 1 proceed_to_stage2 moves. Depth 12 multipv + depth 10 fallbacks.
"""
import io
import json
import os
import sys

import chess
import chess.engine
import chess.pgn

from brilliance_gates import resolve_engine_candidate
from brilliance_eval import (
    EVAL_PERSPECTIVE,
    STAGE2_SEARCH_TIME_S,
    cp_from_info_white,
    cp_to_ep,
    cpl_from_white_scores,
    engine_limit,
    to_mover_cp,
)
from brilliance_stage0 import PIECE_VALUES, analyze_piece_vulnerability

STOCKFISH_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "stockfish", "stockfish-windows-x86-64-avx2.exe")
)

PIECE_SURVIVAL_PLIES = 4
LOSS_THRESHOLD_FLOOR = 150
LOSS_THRESHOLD_PIECE_FRACTION = 0.7
STAGE20_ENGINE_DEPTH = 8


def cp_from_info(info):
    return cp_from_info_white(info)


def piece_survives_plies(board, start_sq, color, piece_type, engine, depth, plies):
    """
    Follow engine best lines; piece must remain on board for `plies` half-moves.
    Tracks the piece from start_sq through captures/moves.
    """
    b = board.copy()
    sq = start_sq

    for _ in range(plies):
        p = b.piece_at(sq)
        if not p or p.color != color or p.piece_type != piece_type:
            return False

        info = engine.analyse(
            b,
            engine_limit(depth=max(6, depth - 2), time_s=1.0),
        )
        pv = info.get("pv") or []
        if not pv:
            return True
        move = pv[0]
        if move.to_square == sq:
            return False
        if move.from_square == sq:
            sq = move.to_square
        b.push(move)

    p = b.piece_at(sq)
    return p is not None and p.color == color and p.piece_type == piece_type


def engine_piece_preservation_check(board, square, color, engine, depth=STAGE20_ENGINE_DEPTH):
    """
    Stage 2.0 micro-check: search-based inevitability for en prise pieces.
    delta = Eval(best preservation line) - Eval(current)
    already_lost if delta < -max(0.7 * piece_value, 150) AND piece survives 4 plies on best save.
    """
    piece = board.piece_at(square)
    if not piece:
        return {"already_lost_engine": False, "skipped": True, "reason": "no_piece"}

    vuln = analyze_piece_vulnerability(board, square, color)
    if not vuln["en_prise_before_move"]:
        return {"already_lost_engine": False, "skipped": True, "reason": "not_en_prise"}

    piece_val = PIECE_VALUES.get(piece.piece_type, 0)
    threshold = max(LOSS_THRESHOLD_PIECE_FRACTION * piece_val, LOSS_THRESHOLD_FLOOR)

    root_info = engine.analyse(
        board,
        engine_limit(depth=depth, time_s=STAGE2_SEARCH_TIME_S),
    )
    current_mover = to_mover_cp(cp_from_info_white(root_info), color)
    if current_mover is None:
        current_mover = 0

    best_save_eval = None
    best_save_move = None

    for m in board.legal_moves:
        if m.from_square != square:
            continue
        b = board.copy()
        b.push(m)
        if not piece_survives_plies(
            b, m.to_square, color, piece.piece_type, engine, depth, PIECE_SURVIVAL_PLIES
        ):
            continue
        info = engine.analyse(
            b,
            engine_limit(depth=depth, time_s=STAGE2_SEARCH_TIME_S),
        )
        ev = to_mover_cp(cp_from_info_white(info), color)
        if ev is None:
            continue
        if best_save_eval is None or ev > best_save_eval:
            best_save_eval = ev
            best_save_move = m

    if best_save_eval is None:
        already_lost = True
        delta = -threshold - 1
    else:
        delta = best_save_eval - current_mover
        already_lost = delta < -threshold

    return {
        "already_lost_engine": already_lost,
        "skipped": False,
        "preservation_delta_cp": round(delta, 1),
        "preservation_threshold_cp": round(threshold, 1),
        "best_preservation_move": board.san(best_save_move) if best_save_move else None,
        "current_eval_mover_cp": current_mover,
        "best_preservation_eval_mover_cp": best_save_eval,
        "survival_plies_required": PIECE_SURVIVAL_PLIES,
        "engine_depth": depth,
        "en_prise_before_move": True,
    }


def shallow_engine_features(board_before, move, color, engine):
    root_info = engine.analyse(
        board_before,
        engine_limit(depth=12, time_s=STAGE2_SEARCH_TIME_S),
    )
    pre_move_eval_white = cp_from_info_white(root_info)
    pre_move_eval_mover = to_mover_cp(pre_move_eval_white, color)

    results = engine.analyse(
        board_before,
        engine_limit(depth=12, time_s=STAGE2_SEARCH_TIME_S),
        multipv=5,
    )
    if not isinstance(results, list):
        results = [results]

    best_score = cp_from_info_white(results[0])
    best_move = results[0]["pv"][0]

    our_score_white = None
    our_rank = 99
    for i, info in enumerate(results):
        if info["pv"] and info["pv"][0] == move:
            our_score_white = cp_from_info_white(info)
            our_rank = i + 1
            break

    board_after = board_before.copy()
    board_after.push(move)

    if our_score_white is None:
        info2 = engine.analyse(
            board_after,
            engine_limit(depth=10, time_s=STAGE2_SEARCH_TIME_S),
        )
        our_score_white = cp_from_info_white(info2)
        our_rank = 99

    cpl = cpl_from_white_scores(best_score, our_score_white, color)

    reasonable = [
        r
        for r in results
        if best_score is not None
        and cp_from_info_white(r) is not None
        and cpl_from_white_scores(best_score, cp_from_info_white(r), color) <= 150
    ]
    is_forced_engine = len(reasonable) <= 2

    best_mover = to_mover_cp(best_score, color)
    our_mover = to_mover_cp(our_score_white, color)
    ep_before = cp_to_ep(best_mover)
    ep_after = cp_to_ep(our_mover) if our_mover is not None else 0.0
    ep_delta = ep_after - ep_before
    ep_pre_position = cp_to_ep(pre_move_eval_mover)

    opp = not color
    opp_results = engine.analyse(
        board_after,
        engine_limit(depth=10, time_s=STAGE2_SEARCH_TIME_S),
        multipv=8,
    )
    if not isinstance(opp_results, list):
        opp_results = [opp_results]

    opp_best_score = cp_from_info_white(opp_results[0])
    response_width = sum(
        1
        for r in opp_results
        if abs(opp_best_score - cp_from_info_white(r)) <= 120
    )

    return {
        "best_move": board_before.san(best_move),
        "best_move_uci": best_move.uci(),
        "best_score_cp": best_score,
        "our_score_cp": our_score_white,
        "our_rank_in_top5": our_rank,
        "cpl_shallow": cpl,
        "ep_delta_shallow": round(ep_delta, 3),
        "ep_before": round(ep_before, 3),
        "ep_after": round(ep_after, 3),
        "ep_pre_position": round(ep_pre_position, 3),
        "pre_move_eval_mover_cp": pre_move_eval_mover,
        "pre_move_eval_white_cp": pre_move_eval_white,
        "is_forced_engine": is_forced_engine,
        "n_reasonable_moves": len(reasonable),
        "response_width": response_width,
        "is_best_or_near_best": cpl <= 50,
        "engine_depth": 12,
        "engine_used": True,
        "eval_perspective": EVAL_PERSPECTIVE,
    }


def apply_stage2_gate(engine_features):
    fail = None

    if engine_features["cpl_shallow"] > 300:
        fail = "cpl_too_high"
    elif engine_features["ep_delta_shallow"] < -0.15:
        fail = "ep_delta_too_negative"

    return {
        "proceed_to_stage3": fail is None,
        "gate_fail_reason": fail,
        "classification_if_fail": "unsound_sacrifice" if fail else None,
    }


def analyze_stage2_move(board, move, ply_index, engine):
    color = board.turn
    stage1, candidate_path = resolve_engine_candidate(board, move, ply_index)
    if not stage1 or not stage1["proceed_to_stage2"]:
        return None

    preservation = engine_piece_preservation_check(board, move.from_square, color, engine)
    if preservation.get("already_lost_engine") and not preservation.get("skipped"):
        sac_class = stage1.get("sacrifice_class") or {}
        return {
            "ply_index": ply_index,
            "san_move": board.san(move),
            "uci_move": move.uci(),
            "turn": "white" if color == chess.WHITE else "black",
            "candidate_path": candidate_path or "sacrifice",
            "stage1": {
                "sac_type": sac_class.get("sac_type"),
                "is_valid_sacrifice": stage1.get("is_valid_sacrifice"),
            },
            "preservation_check": preservation,
            "engine": {"engine_used": True, "stage20_only": True},
            "proceed_to_stage3": False,
            "gate_fail_reason": "piece_already_lost_engine_confirmed",
            "classification_if_fail": "unsound_sacrifice",
            "engine_used": True,
        }

    engine_feats = shallow_engine_features(board, move, color, engine)
    gate = apply_stage2_gate(engine_feats)

    sac_class = stage1.get("sacrifice_class") or {}
    return {
        "ply_index": ply_index,
        "san_move": board.san(move),
        "uci_move": move.uci(),
        "turn": "white" if color == chess.WHITE else "black",
        "candidate_path": candidate_path or "sacrifice",
        "stage1": {
            "sac_type": sac_class.get("sac_type"),
            "is_valid_sacrifice": stage1.get("is_valid_sacrifice"),
        },
        "preservation_check": preservation if preservation.get("en_prise_before_move") else None,
        "engine": engine_feats,
        "proceed_to_stage3": gate["proceed_to_stage3"],
        "gate_fail_reason": gate["gate_fail_reason"],
        "classification_if_fail": gate["classification_if_fail"],
        "engine_used": True,
    }


def analyze_pgn_stage2(pgn_text, engine_path=None):
    path = engine_path or STOCKFISH_PATH
    if not os.path.exists(path):
        raise FileNotFoundError(f"Stockfish not found at {path}")

    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        raise ValueError("Could not parse PGN")

    moves_out = []

    with chess.engine.SimpleEngine.popen_uci(path) as engine:
        try:
            engine.configure({"Threads": 1, "Hash": 128, "MultiPV": 8})
        except chess.engine.EngineError:
            pass

        board = game.board()
        for ply_index, move in enumerate(game.mainline_moves()):
            result = analyze_stage2_move(board, move, ply_index, engine)
            if result:
                result["engine"]["stockfish_path"] = path
                moves_out.append(result)
            board.push(move)

    proceed_count = sum(1 for m in moves_out if m["proceed_to_stage3"])
    disqualified = len(moves_out) - proceed_count

    return {
        "engine_used": True,
        "stockfish_path": path,
        "analyzed_count": len(moves_out),
        "proceed_to_stage3_count": proceed_count,
        "disqualified_count": disqualified,
        "sacrifice_path_count": sum(1 for m in moves_out if m.get("candidate_path") == "sacrifice"),
        "quiet_path_count": sum(1 for m in moves_out if m.get("candidate_path") == "quiet"),
        "defensive_path_count": sum(1 for m in moves_out if m.get("candidate_path") == "defensive"),
        "forced_engine_count": sum(
            1 for m in moves_out if m["gate_fail_reason"] == "forced_engine"
        ),
        "unsound_count": sum(
            1
            for m in moves_out
            if m["gate_fail_reason"] in ("cpl_too_high", "ep_delta_too_negative")
        ),
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

    try:
        result = analyze_pgn_stage2(pgn, engine_path)
        print(json.dumps(result))
        return 0
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
