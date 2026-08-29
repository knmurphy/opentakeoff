def rects(planks,v1,v2,I=12):
    out=[]
    for i in range(-I,I):
        for j in range(-I,I):
            dx=i*v1[0]+j*v2[0]; dy=i*v1[1]+j*v2[1]
            for idx,(x0,y0,x1,y1,o) in enumerate(planks):
                out.append((x0+dx,y0+dy,x1+dx,y1+dy,o,(i,j,idx)))
    return out

def render(planks,v1,v2,xr,yr,scale=1):
    rs=rects(planks,v1,v2)
    lines=[]
    y=yr[1]
    while y>yr[0]:
        row=""
        x=xr[0]
        while x<xr[1]:
            cx=x+0.25; cy=y-0.25
            hit=[r for r in rs if r[0]<cx<r[2] and r[1]<cy<r[3]]
            if not hit: row+=" ."  # gap!
            else:
                o=hit[0][4]
                # label by which plank-instance to see interlock; use orientation char
                row+= " H" if o=='H' else " V"
            x+=0.5
        lines.append(row)
        y-=0.5
    print("\n".join(lines))

# L=2,W=1 herringbone
H=(0,0,2,1,'H'); V=(2,0,3,2,'V')
print("=== Herringbone L=2 W=1  (H=horiz plank, V=vert plank; '.'=gap) ===")
render([H,V],(2,2),(1,-1),(-1,9),(-1,9))
