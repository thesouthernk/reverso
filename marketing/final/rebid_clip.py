# AG Grid re-bid clip from demo-rebid-raw.mp4 (rec times), narrated by vo/d10.wav.
import subprocess
DZ = "crop=1700:660:1000:244,pad=1700:956:0:296:color=0xFCFCFC"  # zoom on floor..status, row near the middle
FULL = "crop=3024:1700:0:244"
PARTS = [(82.0, 88.0, 6.0, DZ), (91.0, 96.0, 5.0, DZ), (96.0, 121.0, 2.5, DZ), (121.0, 125.8, 5.0, DZ), (132.3, 136.3, 4.0, FULL)]
f = [f"[0:v]split={len(PARTS)}" + "".join(f"[s{i}]" for i in range(len(PARTS)))]
for i, (a, b, t, c) in enumerate(PARTS):
    f.append(f"[s{i}]trim={a}:{b},setpts=(PTS-STARTPTS)/{(b-a)/t:.4f},{c},scale=1920:1080:flags=lanczos,fps=30,trim=0:{t}[v{i}]")
T = sum(p[2] for p in PARTS)
f.append("".join(f"[v{i}]" for i in range(len(PARTS))) + f"concat=n={len(PARTS)}:v=1:a=0[v]")
f.append(f"[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=250|250,apad,atrim=0:{T}[a]")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", "demo-rebid-raw.mp4", "-i", "final/vo/d10.wav", "-filter_complex", ";".join(f),
  "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", "final/rebid-clip.mov"], check=True)
