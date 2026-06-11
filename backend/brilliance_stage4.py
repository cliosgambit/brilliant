"""
Brilliance Engine — Stage 4 human perception model.
Runs on Stage 3 passers. No engine — rating-relative surprise, practical brilliance, archetype.
"""
import json
import math
import sys

import chess

RATING_BRACKETS = [
    (0, 1100, 0.4),
    (1100, 1500, 0.3),
    (1500, 1900, 0.2),
    (1900, 2300, 0.1),
    (2300, 2700, 0.05),
    (2700, 9999, 0.01),
]

TYPE_MULTIPLIERS = {
    "queen_sacrifice": 2.5,
    "exchange_sacrifice": 1.8,
    "real_sacrifice": 1.6,
    "positional_piece_placement": 2.0,
    "tactical_sacrifice": 1.2,
    "pseudo_sacrifice": 0.8,
}


def rating_relative_surprise(player_rating, ev_score, rank_at_d8, sac_type):
    base_surprise = min(rank_at_d8 or 99, 10) / 10.0

    rating_factor = 0.2
    for lo, hi, factor in RATING_BRACKETS:
        if lo <= player_rating < hi:
            rating_factor = factor
            break

    type_mult = TYPE_MULTIPLIERS.get(sac_type or "", 1.0)
    ev_bonus = (ev_score or 0) * 0.15
    surprise = min(10.0, (base_surprise + rating_factor + ev_bonus) * type_mult * 5.0)

    p_find = max(0.001, 1.0 - (surprise / 10.0))
    info_surprise = -math.log2(p_find)

    return {
        "player_rating": player_rating,
        "base_non_obvious": round(base_surprise, 3),
        "rating_factor": rating_factor,
        "type_multiplier": type_mult,
        "surprise_score": round(surprise, 2),
        "info_surprise_bits": round(info_surprise, 2),
        "brilliant_for_rating": surprise > 6.0,
    }


def practical_brilliance_score(defense_difficulty, is_sound, deep_eval_mover_cp, tm_score):
    deep_eval_mover_cp = deep_eval_mover_cp or 0
    defense_difficulty = defense_difficulty or 0.0
    tm_score = tm_score or 0

    obj_quality = max(0.0, min(1.0, (deep_eval_mover_cp + 200) / 400.0))
    practical_value = defense_difficulty * (min(tm_score, 20) / 20.0)
    tal_zone = -200 <= deep_eval_mover_cp < -30

    if is_sound:
        pb_score = obj_quality * defense_difficulty * 10.0
        category = "objective_brilliant"
    elif tal_zone and defense_difficulty > 0.7:
        pb_score = practical_value * 7.0
        category = "practical_brilliant"
    else:
        pb_score = practical_value * 3.0
        category = "speculative_sacrifice"

    return {
        "category": category,
        "obj_quality": round(obj_quality, 3),
        "practical_value": round(practical_value, 3),
        "pb_score": round(pb_score, 2),
        "is_tal_zone": tal_zone,
    }


def brilliance_archetype(
    sac_type,
    is_check,
    is_quiet,
    game_phase_val,
    king_safety_delta,
    is_defensive=False,
):
    if is_quiet and not is_check:
        if game_phase_val == "endgame":
            return "endgame_revelation"
        return "quiet_masterstroke"

    if is_defensive:
        return "defensive_brilliance"

    if sac_type == "queen_sacrifice" and (king_safety_delta or 0) < -100:
        return "thunderbolt"

    if sac_type == "exchange_sacrifice":
        return "strategic_masterstroke"

    if is_check and (king_safety_delta or 0) < -80:
        return "ignition"

    if game_phase_val == "endgame":
        return "endgame_coup"

    return "masterstroke"


def detect_stalemate_trap(board, move, color):
    board_after = board.copy()
    board_after.push(move)
    opp = not color
    board_after.turn = opp

    traps_found = []
    for opp_move in list(board_after.legal_moves)[:15]:
        b2 = board_after.copy()
        b2.push(opp_move)
        if b2.is_stalemate():
            traps_found.append(board_after.san(opp_move))

    return {
        "stalemate_traps": traps_found,
        "trap_count": len(traps_found),
        "has_trap": len(traps_found) > 0,
    }


def detect_perpetual_check(board, move, color, max_depth=10):
    board_after = board.copy()
    board_after.push(move)

    if not board_after.is_check():
        return {"has_perpetual": False}

    def _push_copy(b, m):
        bc = b.copy()
        bc.push(m)
        return bc

    def recurse(b, checker, depth, seen_positions):
        if depth >= max_depth:
            return True
        fen = b.fen().split(" ")[0]
        if fen in seen_positions:
            return True
        seen_positions.add(fen)
        if b.is_checkmate():
            return False
        if b.is_stalemate():
            return True
        b.turn = checker
        check_moves = [m for m in b.legal_moves if b.gives_check(m)]
        if not check_moves:
            return False
        for cm in check_moves[:5]:
            b2 = b.copy()
            b2.push(cm)
            b2.turn = not checker
            opp_responses = list(b2.legal_moves)[:5]
            if not opp_responses:
                continue
            if all(recurse(_push_copy(b2, r), checker, depth + 2, seen_positions.copy()) for r in opp_responses):
                return True
        return False

    has_perp = recurse(board_after.copy(), color, 0, set())
    return {
        "has_perpetual": has_perp,
        "starts_with_check": True,
        "depth_searched": max_depth,
    }


def defensive_brilliance_score(board_before, move, color, pre_move_eval_cp, post_move_eval_cp):
    pre_move_eval_cp = pre_move_eval_cp or 0
    post_move_eval_cp = post_move_eval_cp or 0

    is_losing = pre_move_eval_cp < -150
    is_clearly_losing = pre_move_eval_cp < -400
    eval_rescue = post_move_eval_cp - pre_move_eval_cp
    achieves_draw = -50 <= post_move_eval_cp <= 50

    perpetual = detect_perpetual_check(board_before, move, color)
    stalemate = detect_stalemate_trap(board_before, move, color)

    base = 0.0
    archetype = "normal_defense"

    if is_losing:
        if perpetual["has_perpetual"]:
            base += 8.0
            archetype = "perpetual_save"
        if stalemate["has_trap"]:
            base += 9.0
            archetype = "stalemate_brilliance"
        if achieves_draw and not perpetual["has_perpetual"] and not stalemate["has_trap"]:
            base += 5.0
            archetype = "defensive_fortress"
        if is_clearly_losing:
            base += 2.0
        rescue_bonus = min(3.0, eval_rescue / 200)
        base += rescue_bonus

    return {
        "is_losing_position": is_losing,
        "pre_move_eval": pre_move_eval_cp,
        "post_move_eval": post_move_eval_cp,
        "eval_rescue_cp": eval_rescue,
        "achieves_draw": achieves_draw,
        "perpetual": perpetual,
        "stalemate_trap": stalemate,
        "defensive_score": round(base, 2),
        "defensive_archetype": archetype,
        "is_defensive_brilliant": base >= 6.0,
    }


def compute_brilliance_classification(
    non_obvious_score,
    surprise_score,
    pb_score,
    defense_difficulty,
    multiplexing_score,
    ev_score,
    is_sound,
    quiet_score=0,
    is_defensive=False,
    material_deficit=0,
    defensive_score=0,
):
    brilliance = (
        (non_obvious_score or 0) * 0.30
        + (surprise_score or 0) * 0.25
        + (pb_score or 0) * 0.20
        + (defense_difficulty or 0) * 10 * 0.10
        + (multiplexing_score or 0) * 0.10
        + (ev_score or 0) * 0.05
    )

    if quiet_score and quiet_score > 2.0:
        brilliance += (quiet_score / 10.0) * 2.0

    if is_defensive:
        brilliance += min(material_deficit, 500) / 500 * 2.0
        if defensive_score >= 6.0:
            brilliance += defensive_score * 0.15

    brilliance = round(brilliance, 2)

    if brilliance >= 6.5 and is_sound:
        classification = "BRILLIANT"
    elif brilliance >= 5.0 or defensive_score >= 6.0:
        classification = "practical_brilliant"
    elif brilliance >= 3.5:
        classification = "great_sacrifice"
    else:
        classification = "good_sacrifice"

    return brilliance, classification


def analyze_stage4_move(move_input):
    player_rating = int(move_input.get("player_rating") or 1500)
    ev_score = move_input.get("ev_score") or 0
    rank_at_d8 = move_input.get("rank_at_depth8") or 99
    sac_type = move_input.get("sac_type") or "unknown"

    deep_eval_mover = move_input.get("deep_eval_mover_cp")
    if deep_eval_mover is None and move_input.get("deep_eval_cp") is not None:
        cp = move_input["deep_eval_cp"]
        deep_eval_mover = cp if move_input.get("turn") == "white" else -cp

    surprise = rating_relative_surprise(player_rating, ev_score, rank_at_d8, sac_type)
    pb = practical_brilliance_score(
        move_input.get("defense_difficulty"),
        bool(move_input.get("is_sound")),
        deep_eval_mover,
        move_input.get("multiplexing_score"),
    )

    is_quiet = not move_input.get("is_capture") and not move_input.get("is_check")
    archetype = brilliance_archetype(
        sac_type,
        bool(move_input.get("is_check")),
        is_quiet,
        move_input.get("game_phase") or "middlegame",
        move_input.get("king_safety_delta"),
        bool(move_input.get("is_defensive")),
    )

    defensive = None
    fen_before = move_input.get("fen_before")
    move_uci = move_input.get("uci_move")
    if move_input.get("is_defensive") and fen_before and move_uci:
        try:
            board_before = chess.Board(fen_before)
            move = chess.Move.from_uci(move_uci)
            color = chess.WHITE if move_input.get("turn") == "white" else chess.BLACK
            pre_eval = move_input.get("pre_move_eval_mover_cp")
            post_eval = deep_eval_mover
            if pre_eval is not None and post_eval is not None:
                defensive = defensive_brilliance_score(
                    board_before, move, color, pre_eval, post_eval
                )
                if defensive.get("is_defensive_brilliant"):
                    archetype = defensive.get("defensive_archetype") or "defensive_brilliance"
        except Exception:
            defensive = None

    brilliance_score, classification = compute_brilliance_classification(
        move_input.get("non_obvious_score"),
        surprise["surprise_score"],
        pb["pb_score"],
        move_input.get("defense_difficulty"),
        move_input.get("multiplexing_score"),
        ev_score,
        bool(move_input.get("is_sound")),
        quiet_score=move_input.get("quiet_score") or 0,
        is_defensive=bool(move_input.get("is_defensive")),
        material_deficit=move_input.get("material_deficit") or 0,
        defensive_score=(defensive or {}).get("defensive_score") or 0,
    )

    return {
        "ply_index": move_input.get("ply_index"),
        "san_move": move_input.get("san_move"),
        "turn": move_input.get("turn"),
        "sac_type": sac_type,
        "surprise": surprise,
        "practical": pb,
        "defensive": defensive,
        "archetype": archetype,
        "brilliance_score": brilliance_score,
        "classification": classification,
        "is_brilliant": classification == "BRILLIANT",
        "engine_used": False,
    }


def analyze_stage4_batch(moves_input):
    moves_out = []
    for m in moves_input or []:
        moves_out.append(analyze_stage4_move(m))

    brilliant_count = sum(1 for m in moves_out if m["is_brilliant"])
    practical_count = sum(
        1 for m in moves_out if m["classification"] in ("BRILLIANT", "practical_brilliant")
    )

    return {
        "engine_used": False,
        "analyzed_count": len(moves_out),
        "brilliant_count": brilliant_count,
        "practical_brilliant_count": practical_count,
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

    moves = payload.get("moves")
    if not moves:
        print(json.dumps({"error": "moves array is required"}))
        return 1

    try:
        result = analyze_stage4_batch(moves)
        print(json.dumps(result))
        return 0
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
