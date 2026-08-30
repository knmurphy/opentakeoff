def rects(planks, v1, v2, I=8):
    out=[]
    for i in range(-I,I):
        for j in range(-I,I):
            dx=i*v1[0]+j*v2[0]; dy=i*v1[1]+j*v2[1]
            for (x0,y0,x1,y1) in planks:
                out.append((x0+dx,y0+dy,x1+dx,y1+dy))
    return out

def covers(planks,v1,v2,step=0.5,win=6):
    rs=rects(planks,v1,v2)
    ok=True; bad=0
    n=int(win/step)
    for ix in range(-n,n):
        for iy in range(-n,n):
            cx=ix*step+step/2; cy=iy*step+step/2
            k=sum(1 for (x0,y0,x1,y1) in rs if x0<cx<x1 and y0<cy<y1)
            if k!=1:
                ok=False; bad+=1
    return ok,bad

# HERRINGBONE general L x W. motif: H=[0,L]x[0,W] , V=[L,L+W]x[0,L]
def hb(L,W):
    H=(0,0,L,W); V=(L,0,L+W,L)
    v1=(L,L); v2=(W,-W)
    return [H,V],v1,v2

for (L,W) in [(2,1),(3,1),(4,2),(3,2),(2.0,1.0),(2.5,1.0)]:
    planks,v1,v2=hb(L,W)
    det=v1[0]*v2[1]-v1[1]*v2[0]
    ok,bad=covers(planks,v1,v2)
    print(f"HB L={L} W={W} ratio={L/W:g}: v1={v1} v2={v2} det={det} area2planks={2*L*W} gapfree={ok} bad={bad}")

print()
# BASKETWEAVE 2:1. Block pair in a 2x2 (LxL) square:
#   left half: two horizontal planks stacked: [0,2]x[0,1],[0,2]x[1,2]
#   right half: two vertical planks side by side: [2,3]x[0,2],[3,4]x[0,2]  -> that's 4x2 block
# Standard basketweave repeat = 2 blocks = a square of side 2L? Build the classic:
# A 2L x 2L cell (here 4x4) with 4 pairs pinwheeled. Simpler canonical basketweave:
# block A (horiz pair) occupies [0,2]x[0,2]; block B (vert pair) occupies [2,4]x[0,2]; row2 swaps.
def bw(L=2,W=1):
    # horizontal-pair block filling an LxL square: two planks [0,L]x[0,W],[0,L]x[W,2W]  (needs L=2W)
    hpair=lambda ox,oy:[(ox,oy,ox+L,oy+W),(ox,oy+W,ox+L,oy+2*W)]
    vpair=lambda ox,oy:[(ox,oy,ox+W,oy+L),(ox+W,oy,ox+2*W,oy+L)]
    planks=[]
    planks+=hpair(0,0); planks+=vpair(L,0)      # bottom row: H then V
    planks+=vpair(0,L); planks+=hpair(L,L)      # top row: V then H  (checkerboard of blocks)
    v1=(2*L,0); v2=(0,2*L)
    return planks,v1,v2
planks,v1,v2=bw(2,1)
ok,bad=covers(planks,v1,v2,win=8)
det=v1[0]*v2[1]-v1[1]*v2[0]
print(f"BASKETWEAVE L=2 W=1: cell v1={v1} v2={v2} det={det} planks/cell={len(planks)} area={len(planks)*2} gapfree={ok} bad={bad}")

# Does a smaller cell (single LxL block, i.e. v1=(2,0),v2=(0,2)) tile? (checkerboard broken)
planks2=[(0,0,2,1),(0,1,2,2)]  # just horiz pair block
ok2,_=covers(planks2,(2,0),(0,2),win=6)
print("  single 2x2 horiz-pair block under (2,0),(0,2) -> that's just running rows, gapfree=",ok2)
