from fractions import Fraction as F

# Planks are 2 x 1 (L=2, W=1). Straight (axis-aligned) herringbone.
# Motif = one horizontal + one vertical plank forming the interlock.
# H at anchor (x,y): [x,x+2] x [y,y+1]   ; V at anchor (x,y): [x,x+1] x [y,y+2]
def rects(motif, v1, v2, I=6):
    out=[]
    for i in range(-I,I):
        for j in range(-I,I):
            dx=i*v1[0]+j*v2[0]; dy=i*v1[1]+j*v2[1]
            for (kind,ax,ay) in motif:
                if kind=='H': out.append((ax+dx,ay+dy,ax+dx+2,ay+dy+1))
                else:         out.append((ax+dx,ay+dy,ax+dx+1,ay+dy+2))
    return out

def covers(motif,v1,v2):
    rs=rects(motif,v1,v2)
    # sample cell centers on half-integer grid inside a central window, count coverage
    from collections import Counter
    c=Counter()
    ok=True
    for X2 in range(-8,8):      # x = X2/2 + 0.25 style: sample centers of 0.5x0.5 cells
        for Y2 in range(-8,8):
            cx=X2/2+0.25; cy=Y2/2+0.25
            n=sum(1 for (x0,y0,x1,y1) in rs if x0<cx<x1 and y0<cy<y1)
            if n!=1: ok=False
    return ok

# Candidate motif: H0 and V0 to its upper-right forming the staircase interlock
motif=[('H',0,0),('V',2,0)]
v1=(2,2)
# search v2
found=[]
for a in range(-4,5):
    for b in range(-4,5):
        v2=(a,b)
        det=v1[0]*v2[1]-v1[1]*v2[0]
        if det==0: continue
        if covers(motif,v1,v2):
            found.append((v2,det))
print("motif H(0,0)+V(2,0), v1=(2,2). Working v2 (v2,det):")
for f in sorted(found,key=lambda t:abs(t[1])): print("  ",f)

# Also test the pure 4-plank square-lattice basketweave block for comparison
# Basketweave block-pair: 2 horiz stacked in left 2x2 half? Standard: 2x2 square split:
# left cell: two horizontal planks stacked [0,2]x[0,1],[0,2]x[1,2]
# ... report separately below
