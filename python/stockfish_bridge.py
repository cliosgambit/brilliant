import argparse
import json
import os
import subprocess
import sys
import time

def read_lines(proc):
    lines = []
    while True:
        line = proc.stdout.readline()
        if not line:
            break
        line = line.strip()
        if line:
            lines.append(line)
            if line.startswith("bestmove"):
                break
    return lines

def parse_score(lines):
    score = None
    depth = None
    pv = None
    for line in lines:
        if line.startswith("info "):
            parts = line.split()
            if "depth" in parts:
                try:
                    depth = int(parts[parts.index("depth")+1])
                except Exception:
                    pass
            if "score" in parts:
                idx = parts.index("score")
                if idx+2 < len(parts):
                    t = parts[idx+1]
                    v = parts[idx+2]
                    if t == "cp":
                        try:
                            score = {"type":"cp","value": int(v)}
                        except Exception:
                            pass
                    elif t == "mate":
                        try:
                            score = {"type":"mate","value": int(v)}
                        except Exception:
                            pass
            if "pv" in parts:
                pv = " ".join(parts[parts.index("pv")+1:])
    return score, depth, pv

def parse_best(lines):
    for line in lines:
        if line.startswith("bestmove"):
            parts = line.split()
            best = parts[1]
            ponder = parts[3] if len(parts) >= 4 and parts[2] == "ponder" else None
            return best, ponder
    return None, None

def run_engine(fen, depth=None, movetime=None):
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    exe_path = os.path.join(base_dir, "stockfish", "stockfish-windows-x86-64-avx2.exe")
    if not os.path.isfile(exe_path):
        return {"error": "Stockfish executable not found", "path": exe_path}
    proc = subprocess.Popen([exe_path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    def send(cmd):
        proc.stdin.write(cmd + "\n")
        proc.stdin.flush()
    send("uci")
    time.sleep(0.05)
    send("isready")
    time.sleep(0.05)
    send("ucinewgame")
    if fen.strip().lower() == "startpos":
        send("position startpos")
    else:
        send(f"position fen {fen}")
    if movetime:
        send(f"go movetime {int(movetime)}")
    else:
        d = depth if depth else 12
        send(f"go depth {int(d)}")
    lines = read_lines(proc)
    best, ponder = parse_best(lines)
    score, out_depth, pv = parse_score(lines)
    try:
        send("quit")
    except Exception:
        pass
    result = {
        "bestmove": best,
        "ponder": ponder,
        "score": score,
        "depth": out_depth,
        "pv": pv
    }
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fen", required=True)
    parser.add_argument("--depth", type=int, default=None)
    parser.add_argument("--movetime", type=int, default=None)
    args = parser.parse_args()
    res = run_engine(args.fen, args.depth, args.movetime)
    print(json.dumps(res))

if __name__ == "__main__":
    main()
