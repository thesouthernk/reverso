# Final hackathon cut: 3D opening + real app recording (sped up per beat, VO on top) + 3D closing.
import subprocess
OFF = 3.0  # recording time = script time + OFF (already folded in below)
SEG = [  # rec start, rec end, target length, vo
  (3.4, 20.5, 7.6, "d1"), (23.7, 52.7, 8.8, "d2"), (52.7, 65.8, 3.8, "d3"),
  (65.8, 105.0, 9.0, "d4"), (105.0, 127.6, 15.6, "d5"), (127.6, 141.0, 6.5, "d6"),
  (141.0, 157.5, 5.0, "d7"), (157.5, 168.5, 5.3, "d8"), (169.0, 204.5, 14.4, "d9")]
OPEN, CLOSE = (0, 38.6), (119.2, 130.7)
ins = ["-i", "reverso-3d-v2.mp4", "-i", "demo-raw.mp4"] + sum((["-i", f"final/vo/{s[3]}.wav"] for s in SEG), []) + ["-i", "final/rebid-clip.mov"]  # rebid clip: final/rebid_clip.py
RB = len(SEG) + 2
f, parts = [], []
f.append("[0:v]split=2[o0][o1];[0:a]asplit=2[oa0][oa1]")
f.append(f"[o0]trim={OPEN[0]}:{OPEN[1]},setpts=PTS-STARTPTS,fade=t=out:st={OPEN[1]-OPEN[0]-0.3}:d=0.3[va];[oa0]atrim={OPEN[0]}:{OPEN[1]},asetpts=PTS-STARTPTS[aa]")
f.append(f"[o1]trim={CLOSE[0]}:{CLOSE[1]},setpts=PTS-STARTPTS,fade=t=in:d=0.3[vc];[oa1]atrim={CLOSE[0]}:{CLOSE[1]},asetpts=PTS-STARTPTS[ac]")
f.append(f"[1:v]crop=3024:1700:0:244,scale=1920:1080:flags=lanczos,split={len(SEG)}" + "".join(f"[r{i}]" for i in range(len(SEG))))
parts.append("[va][aa]")
for i, (a, b, t, _) in enumerate(SEG):
    sp = (b - a) / t
    fi = ",fade=t=in:d=0.3" if i == 0 else ""
    fo = ""
    f.append(f"[r{i}]trim={a}:{b},setpts=(PTS-STARTPTS)/{sp:.4f},fps=30,trim=0:{t}{fi}{fo}[v{i}]")
    f.append(f"[{i+2}:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=250|250,apad,atrim=0:{t}[a{i}]")
    parts.append(f"[v{i}][a{i}]")
f.append(f"[{RB}:v]fps=30,fade=t=out:st=22.2:d=0.3[vr];[{RB}:a]aresample=48000[ar]")
parts.append("[vr][ar]")
parts.append("[vc][ac]")
f.append("".join(parts) + f"concat=n={len(parts)}:v=1:a=1[v][a];[a]loudnorm=I=-16:TP=-1.5[ao]")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-stats", *ins, "-filter_complex", ";".join(f), "-map", "[v]", "-map", "[ao]",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
  "final/reverso-hackathon.mp4"], check=True)
