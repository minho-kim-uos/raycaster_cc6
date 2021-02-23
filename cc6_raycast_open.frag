#version 330 core

#define ONE_OVER_8      0.125
#define ONE_OVER_64     0.015625
#define ONE_OVER_384    0.00260416666

#define TYPE_BLUE   0
#define TYPE_GREEN  1
#define TYPE_RED    2

#define RENDER_MODE_BLINN_PHONG 0
#define RENDER_MODE_CURVATURE 1

in vec2 vTexCoord;
out vec4 fColor;

uniform int         render_mode;
uniform mat4        MV;
uniform sampler2D   tex_back;
uniform sampler2D   tex_front;
uniform sampler3D   tex_volume;
uniform sampler2D   tex_colormap_2d;
uniform vec3        scale_axes;
uniform vec3        dim;
uniform float       level;
uniform float       scale_step;

float[38]   c;
vec4    u;
float   u2000, u3000, u0200, u0300, u0020, u0030, u0002, u0003;
float   u1100, u1010, u1001, u0110, u0101, u0011;
ivec3   org;
ivec3   type_R;
int     type_P;
int     type_tet;
int     idx;

#define u0  u[0]
#define u1  u[1]
#define u2  u[2]
#define u3  u[3]

#define c0  c[0]
#define c1  c[1]
#define c2  c[2]
#define c3  c[3]
#define c4  c[4]
#define c5  c[5]
#define c6  c[6]
#define c7  c[7]
#define c8  c[8]
#define c9  c[9]
#define c10 c[10]
#define c11 c[11]
#define c12 c[12]
#define c13 c[13]
#define c14 c[14]
#define c15 c[15]
#define c16 c[16]
#define c17 c[17]
#define c18 c[18]
#define c19 c[19]
#define c20 c[20]
#define c21 c[21]
#define c22 c[22]
#define c23 c[23]
#define c24 c[24]
#define c25 c[25]
#define c26 c[26]
#define c27 c[27]
#define c28 c[28]
#define c29 c[29]
#define c30 c[30]
#define c31 c[31]
#define c32 c[32]
#define c33 c[33]
#define c34 c[34]
#define c35 c[35]
#define c36 c[36]
#define c37 c[37]

#define EVAL(p) (preprocess(p), fetch_coefficients(), eval_M())


struct TMaterial
{
    vec3    ambient;
    vec3    diffuse;
    vec3    specular;
    vec3    emission;
    float   shininess;
};
struct TLight
{
    vec4    position;
    vec3    ambient;
    vec3    diffuse;
    vec3    specular;
};


TMaterial   uMaterial[2] =
TMaterial[2]
(
    TMaterial(
        // front material -- silver
        vec3(0.19225,0.19225,0.19225), 
        vec3(0.50754,0.50754,0.50754),
        vec3(0.508273,0.508273,0.508273), 
        vec3(0,0,0), 
        0.4*128.0), 
    TMaterial(
        // back material -- red plastic
        vec3(0, 0, 0),
        vec3(0.5, 0.0, 0.0),
        vec3(0.7, 0.6, 0.6),
        vec3(0,0,0),
        .25*128.0)  // red plastic
);

TLight  uLight = TLight(
        vec4(1,1,1,0),
        vec3(.2,.2,.2),
        vec3(1,1,1),
        vec3(1,1,1)
        );

vec4 shade_Blinn_Phong(vec3 n, vec4 pos_eye, TMaterial material, TLight light)
{
    vec3    l;
    if(light.position.w == 1.0)
        l = normalize((light.position - pos_eye).xyz);		// positional light
    else
        l = normalize((light.position).xyz);	// directional light
    vec3    v = -normalize(pos_eye.xyz);
    vec3    h = normalize(l + v);
    float   l_dot_n = max(dot(l, n), 0.0);
    vec3    ambient = light.ambient * material.ambient;
    vec3    diffuse = light.diffuse * material.diffuse * l_dot_n;
    vec3    specular = vec3(0.0);
    
    if(l_dot_n >= 0.0)
    {
        specular = light.specular * material.specular * pow(max(dot(h, n), 0.0), material.shininess);
    }
    return vec4(ambient + diffuse + specular, 1);
}

void preprocess(vec3 p_in)
{
    org = ivec3(round(p_in));   // the nearest lattice point

    vec3    p_local = p_in - vec3(org); // local coords w.r.t. "org"

    // type_R == "sign change" matrix of p_local
    // (the octant of p_local)
    //    octant       type_R
    //   (-,-,-) --> (-1,-1,-1)
    //   (-,-,+) --> (-1,-1,+1)
    //      :
    //      :
    //   (+,+,+) --> (+1,+1,+1)
    type_R = 2*ivec3(p_local.x>0, p_local.y>0, p_local.z>0)-1;
    
    // p_cube = (sign_change_matrix) * p_local
    // p_cube is now in the (+,+,+) octant
    vec3    p_cube = p_local.xyz*vec3(type_R);
    
    // membership test against the four knot planes in the (+,+,+) octant
    ivec4   bit = ivec4( p_cube[0]-p_cube[1]-p_cube[2]>0,
                        -p_cube[0]+p_cube[1]-p_cube[2]>0,
                        -p_cube[0]-p_cube[1]+p_cube[2]>0,
                         p_cube[0]+p_cube[1]+p_cube[2]>1);

    // obtain the tetrahedron type where "p_cube" belongs
    // bit_tet   type_tet type_P permutation
    // 0 1 2 3
    // -------------------------------------
    // 1 0 0 0       2      0        123    (red)  
    // 0 1 0 0       2      1        231    (red)
    // 0 0 1 0       2      2        312    (red)
    // 0 0 0 1       0      0        123    (blue)
    // 0 0 0 0       1      0        123    (green)
    type_tet = (1+bit[3])*(bit[0]+bit[1]+bit[2]) + (1-bit[3]);  // 0 (blue), 1 (green), 2 (red)

    // obtain the permutation matrix of p_cube
    //  permutation   type_P
    //   matrix P
    //    [1 0 0]
    //    [0 1 0]       0
    //    [0 0 1]
    //
    //    [0 0 1]
    //    [1 0 0]       1
    //    [0 1 0]
    //
    //    [0 1 0]
    //    [0 0 1]       2
    //    [1 0 0]              
    type_P = bit[1] + 2*bit[2]; // one of three even permutations
    
    // Apply the permutation to "p_cube" to obtain "p_ref" in the "reference tetrahedron."
    // p_ref = P^{-1}*p_cube
    vec4    p_ref = vec4(p_cube[type_P],
                         p_cube[(type_P+1)%3],
                         p_cube[(type_P+2)%3], 1);
    
    // Compute the barycentric coordinates
    //
    // type_tet              vertices         matrix
    //                        matrix
    //                     v1  v2  v3  v4
    //                   [ 0  1/2 1/2 1/2]            [-2  0  0  1]
    // TYPE_BLUE   Vb := [1/2  0  1/2 1/2]  Vb^{-1} = [ 0 -2  0  1]
    //                   [1/2 1/2  0  1/2]            [ 0  0 -2  1]
    //                   [ 1   1   1   1 ]            [ 2  2  2 -2]
    //
    //         
    //                     v1  v2  v3  v4
    //                   [ 0   0  1/2 1/2]            [-1 -1 -1  1]
    // TYPE_GREEN  Vg := [ 0  1/2  0  1/2]  Vg^{-1} = [-1  1  1  0]
    //                   [ 0  1/2 1/2  0 ]            [ 1 -1  1  0]
    //                   [ 1   1   1   1 ]            [ 1  1 -1  0]
    //         
    //                     v1  v2  v3  v4
    //                   [ 0  1/2 1/2 1/2]            [-2  0  0  1]
    // TYPE_RED    Vr := [ 0   0   0  1/2]  Vr^{-1} = [ 0  0  2  0]
    //                   [ 0  1/2  0   0 ]            [ 2 -2 -2  0]
    //                   [ 1   1   1   1 ]            [ 0  2  0  0]
    // 
    u = float(type_tet==TYPE_BLUE)*2.0
            *vec4(-p_ref.x                +0.5*p_ref.w,
                          -p_ref.y        +0.5*p_ref.w,
                                  -p_ref.z+0.5*p_ref.w,
                   p_ref.x+p_ref.y+p_ref.z    -p_ref.w)

        +float(type_tet==TYPE_GREEN)
            *vec4(-p_ref.x-p_ref.y-p_ref.z    +p_ref.w,
                  -p_ref.x+p_ref.y+p_ref.z            ,
                   p_ref.x-p_ref.y+p_ref.z            ,
                   p_ref.x+p_ref.y-p_ref.z            )

        +float(type_tet==TYPE_RED)*2.0
            *vec4(-p_ref.x                +0.5*p_ref.w,
                                   p_ref.z            ,
                   p_ref.x-p_ref.y-p_ref.z            ,
                           p_ref.y                  );
}


// * Fetching 38 coefficients.
// While the stencil size of cc6 is 32, its pattern is different for each type.
// Therefore, we fetch 38, which is the union of three stencil sets, 
// to reduce the branching overhead.
void fetch_coefficients(void)
{

    // three axis directions obtained by the matrix (RP)
    //
    //       [     :      :     ]
    //  RP = [dirx : diry : dirz]
    //       [     :      :     ]
    //
    ivec3   bit_P = ivec3(type_P==0, type_P==1, type_P==2);
    ivec3   dirx = ivec3(type_R.x*bit_P.x, type_R.y*bit_P.y, type_R.z*bit_P.z);
    ivec3   diry = ivec3(type_R.x*bit_P.z, type_R.y*bit_P.x, type_R.z*bit_P.y);
    ivec3   dirz = ivec3(type_R.x*bit_P.y, type_R.y*bit_P.z, type_R.z*bit_P.x);
    
    ivec3   coords = org;
#define GET_DATA(texcoords)	texelFetch(tex_volume, texcoords, 0).r
#define FETCH_C(idx_c, offset)	coords += (offset); c[idx_c] = GET_DATA(coords);
    c[10] = GET_DATA(coords);
    FETCH_C(23, dirx);
    FETCH_C(22, -dirz);
    FETCH_C(33, dirx);
    FETCH_C(34, dirz);
    FETCH_C(32, -diry);
    FETCH_C(20, -dirx);
    FETCH_C(19, -dirz);
    FETCH_C(6, -dirx);
    FETCH_C(7, dirz);
    FETCH_C(0, -dirx);
    FETCH_C(2, diry);
    FETCH_C(1, -dirz);
    FETCH_C(9, dirx);
    FETCH_C(13, diry);
    FETCH_C(26, dirx);
    FETCH_C(27, dirz);
    FETCH_C(36, dirx);
    FETCH_C(4, -3*dirx);
    FETCH_C(14, dirx);
    FETCH_C(17, diry);
    FETCH_C(30, dirx);
    FETCH_C(31, dirz);
    FETCH_C(18, -dirx);
    FETCH_C(15, -diry);
    FETCH_C(5, -dirx);
    FETCH_C(3, -diry);
    FETCH_C(11, dirx);
    FETCH_C(8, -diry);
    FETCH_C(21, dirx);
    FETCH_C(24, diry);
    FETCH_C(35, dirx);
    FETCH_C(37, diry);
    FETCH_C(28, -dirx);
    FETCH_C(29, dirz);
    FETCH_C(16, -dirx);
    FETCH_C(12, -diry);
    FETCH_C(25, dirx);

#undef  FETCH_C
#undef  GET_DATA
}


float eval_M_expr_blue()
{
    return 
    + 12*(u2000*(u1*(17*(c10 + c11) + 11*(c14 + c15) + 7*(c23 + c24) + 5*(c27 + c28) + 3*(c2 + c3) + 2*(c7 + c8) + (c4 + c5 + c9 + c12 + c13 + c16))
               + u2*(17*(c10 + c14) + 11*(c11 + c15) + 7*(c23 + c27) + 5*(c24 + c28) + 3*(c2 + c4) + 2*(c13 + c9) + (c3 + c5 + c7 + c8 + c17 + c18))
               + u3*(14*(c10 + c11 + c14 + c15) + 6*(c23 + c24 + c27 + c28) + 2*(c2 + c3 + c4 + c5) + (c7 + c8 + c9 + c12 + c13 + c16 + c17 + c18)))
        + u0*(u0200*(17*(c10 + c11) + 11*(c23 + c24) + 7*(c14 + c15) + 5*(c27 + c28) + 3*(c7 + c8) + 2*(c2 + c3) + (c9 + c25 + c12 + c20 + c21 + c22))
               + 2*u1*u2*(18*c10 + 12*(c11 + c14 + c23) + 8*(c15 + c24 + c27) + 6*c28 + 2*(c2 + c7 + c9) + (c3 + c4 + c8 + c13 + c20 + c22))
               + u3*(u1*(30*(c10 + c11) + 20*(c14 + c15 + c23 + c24) + 14*(c27 + c28) + 3*(c2 + c3 + c7 + c8) + 2*(c9 + c12) + (c4 + c5 + c13 + c16 + c20 + c21 + c22 + c25))
                   + u2*(30*(c10 + c14) + 20*(c11 + c15 + c23 + c27) + 14*(c24 + c28) + 3*(c2 + c4 + c9 + c13) + 2*(c7 + c17) + (c3 + c5 + c8 + c18 + c20 + c22 + c26 + c30))
               )
               + u0020*(17*(c10 + c14) + 11*(c23 + c27) + 7*(c11 + c15) + 5*(c24 + c28) + 3*(c9 + c13) + 2*(c2 + c4) + (c7 + c17 + c20 + c22 + c26 + c30))
         )
        + u0200*(u2*(17*(c10 + c23) + 11*(c11 + c24) + 7*(c14 + c27) + 5*(c15 + c28) + 3*(c7 + c20) + 2*(c9 + c22) + (c2 + c3 + c8 + c21 + c34 + c35))
               + u3*(14*(c10 + c11 + c23 + c24) + 6*(c14 + c15 + c27 + c28) + 2*(c7 + c8 + c20 + c21) + (c2 + c3 + c9 + c12 + c22 + c25 + c34 + c35))
        )
        + u0020*(u1*(17*(c10 + c23) + 11*(c14 + c27) + 7*(c11 + c24) + 5*(c15 + c28) + 3*(c9 + c22) + 2*(c7 + c20) + (c2 + c4 + c13 + c26 + c34 + c36))
               + u3*(14*(c10 + c14 + c23 + c27) + 6*(c11 + c15 + c24 + c28) + 2*(c9 + c13 + c22 + c26) + (c2 + c4 + c7 + c17 + c20 + c30 + c34 + c36))
        )
        + u1*u2*u3*(30*(c10 + c23) + 20*(c11 + c14 + c24 + c27) + 14*(c15 + c28) + 3*(c7 + c9 + c20 + c22) + 2*(c2 + c34) + (c3 + c8 + c13 + c21 + c26 + c35 + c36 + c4))
    )
    + 4*(u0300*(14*(c10 + c11 + c23 + c24) + 4*(c7 + c8 + c14 + c15 + c20 + c21 + c27 + c28) + (c2 + c3 + c9 + c12 + c22 + c25 + c34 + c35))
       + u3000*(14*(c10 + c11 + c14 + c15) + 4*(c2 + c23 + c24 + c27 + c28 + c3 + c4 + c5) + (c7 + c8 + c9 + c12 + c13 + c16 + c17 + c18))
       + u0030*(14*(c10 + c14 + c23 + c27) + 4*(c9 + c11 + c13 + c15 + c22 + c24 + c26 + c28) + (c2 + c4 + c7 + c17 + c20 + c30 + c34 + c36))
    )
    + 3*u0002*(u0*(50*(c10 + c11 + c14 + c15) + 34*(c23 + c24 + c27 + c28) + 4*(c2 + c3 + c4 + c5) + 3*(c7 + c8 + c9 + c12 + c13 + c16 + c17 + c18) + (c20 + c21 + c22 + c25 + c26 + c29 + c30 + c31))
              + u1*(50*(c10 + c11 + c23 + c24) + 34*(c14 + c15 + c27 + c28) + 4*(c20 + c21) + 4*(c7 + c8) + 3*(c2 + c3 + c9 + c12 + c22 + c25 + c34 + c35) + (c4 + c5 + c13 + c16 + c26 + c29 + c36 + c37))
              + u2*(50*(c10 + c14 + c23 + c27) + 34*(c11 + c15 + c24 + c28) + 4*(c9 + c13 + c22 + c26) + 3*(c2 + c4 + c7 + c17 + c20 + c30 + c34 + c36) + (c3 + c5 + c8 + c18 + c21 + c31 + c35 + c37))
    )
    + 2*u0003*(21*(c10 + c11 + c14 + c15 + c23 + c24 + c27 + c28) + (c2 + c3 + c4 + c5 + c7 + c8 + c9 + c12 + c13 + c16 + c17 + c18 + c20 + c21 + c22 + c25 + c26 + c29 + c30 + c31 + c34 + c35 + c36 + c37));
}
float eval_M_expr_green()
{
    return 
        4*
        (
        + 6*(u0*(u0200*(10*c10 + 7*(c11+c14) + 4*c15 + 3*(c2+c23) + 2*(c3 + c4 + c24 + c27) + (c5 + c7 + c8 + c9 + c13 + c28))
               + u0020*(10*c10 + 7*(c11+c23) + 4*c24 + 3*(c7+c14) + 2*(c8 + c15 + c20 + c27) + (c2 + c9 + c21 + c22 + c28 + c3))
               + u0002*(10*c10 + 7*(c14+c23) + 4*c27 + 3*(c9+c11) + 2*(c13 + c15 + c22 + c24) + (c2 + c4 + c7 + c20 + c26 + c28))
               + u1*(u2*(22*c10 + 16*c11 + 10*(c14+c23) + 6*(c15+c24) + 4*(c2 + c7 + c27) + 3*(c3+c8) + 2*(c9+c28) + (c4 + c13 + c20 + c22))
                   + u3*(22*c10 + 16*c14 + 10*(c11+c23) + 6*(c15+c27) + 4*(c2 + c9 + c24) + 3*(c4+c13) + 2*(c7+c28) + (c3 + c8 + c20 + c22))
               )
               + u2*u3*(22*c10 + 16*c23 + 10*(c11+c14) + 6*(c24+c27) + 4*(c7 + c9 + c15) + 3*(c20+c22) + 2*(c2+c28) + (c3 + c4 + c8 + c13))
           )
           + u1*u2*u3*(18*c10 + 12*(c11 + c14 + c23) + 8*(c15 + c24 + c27) + 6*c28 + 2*(c2 + c7 + c9) + (c3 + c4 + c8 + c13 + c20 + c22))
        )
        + 3*(u2000*(u1*(24*c10 + 12*(c11+c14) + 8*(c2+c23) + 4*(c7 + c9 + c15) + 3*(c3 + c4 + c24 + c27) + 2*(c8 + c13) + (c0 + c1 + c20 + c22))
                  + u2*(24*c10 + 12*(c11+c23) + 8*(c7+c14) + 4*(c2 + c9 + c24) + 3*(c8 + c15 + c20 + c27) + 2*(c3 + c22) + (c0 + c4 + c6 + c13))
                  + u3*(24*c10 + 12*(c14+c23) + 8*(c9 + c11) + 4*(c2 + c7 + c27) + 3*(c13 + c15 + c22 + c24) + 2*(c4 + c20) + (c1 + c3 + c6 + c8))
           )
           + u0200*(u2*(17*(c10+c11) + 11*(c14+c15) + 7*(c23+c24) + 5*(c27+c28) + 3*(c2+c3) + 2*(c7+c8) + (c4 + c5 + c9 + c12 + c13 + c16))
                  + u3*(17*(c10+c14) + 11*(c11+c15) + 7*(c23+c27) + 5*(c24+c28) + 3*(c2+c4) + 2*(c9+c13) + (c3 + c5 + c7 + c8 + c17 + c18))
           )
           + u0020*(u1*(17*(c10+c11) + 11*(c23+c24) + 7*(c14+c15) + 5*(c27+c28) + 3*(c7+c8) + 2*(c2+c3) + (c9 + c12 + c20 + c21 + c22 + c25))
                  + u3*(17*(c10+c23) + 11*(c11+c24) + 7*(c14+c27) + 5*(c15+c28) + 3*(c7+c20) + 2*(c9+c22) + (c2 + c3 + c8 + c21 + c34 + c35))
           )
           + u0002*(u1*(17*(c10+c14) + 11*(c23+c27) + 7*(c11+c15) + 5*(c24+c28) + 3*(c9+c13) + 2*(c2+c4) + (c7 + c17 + c20 + c22 + c26 + c30))
                  + u2*(17*(c10+c23) + 11*(c14+c27) + 7*(c11+c24) + 5*(c15+c28) + 3*(c9+c22) + 2*(c7+c20) + (c2 + c4 + c13 + c26 + c34 + c36))
           )
        )
        + 2*u3000*(12*c10 + 4*(c2 + c7 + c9 + c11 + c14 + c23) + (c0 + c1 + c8 + c13 + c15 + c20 + c22 + c24 + c27 + c3 + c4 + c6))
        + u0300*(14*(c10 + c11 + c14 + c15) + 4*(c2 + c23 + c24 + c27 + c28 + c3 + c4 + c5) + (c7 + c8 + c9 + c12 + c13 + c16 + c17 + c18))
        + u0030*(14*(c10 + c11 + c23 + c24) + 4*(c7 + c8 + c14 + c15 + c20 + c21 + c27 + c28) + (c2 + c3 + c9 + c12 + c22 + c25 + c34 + c35))
        + u0003*(14*(c10 + c14 + c23 + c27) + 4*(c9 + c11 + c13 + c15 + c22 + c24 + c26 + c28) + (c2 + c4 + c7 + c17 + c20 + c30 + c34 + c36))
        );
}
float eval_M_expr_red() 
{
    return (
        + 24*u0*(u0200*( + 10*c10 + 7*(c11 + c23) + 4*c24 + 3*(c14 + c7) + 2*(c15 + c20 + c27 + c8) + (c21 + c22 + c28 + c2 + c3 + c9) )
               + u0002*( + 10*c10 + 7*(c14 + c23) + 4*c27 + 3*(c11 + c9) + 2*(c13 + c15 + c22 + c24) + (c20 + c26 + c28 + c2 + c4 + c7))
               + u1*u3*( + 22*c10 + 16*c23 + 10*(c11 + c14) + 6*(c24 + c27) + 4*(c15 + c7 + c9) + 3*(c20 + c22) + 2*(c28 + c2) + (c13 + c3 + c4 + c8))
        )
        + 12*(u2000*(u1*( + 24*c10 + 12*(c11 + c23) + 8*(c14 + c7) + 4*(c24 + c2 + c9) + 3*(c15 + c20 + c27 + c8) + 2*(c22 + c3) +(c0 + c13 + c4 + c6)) 
                   + u2*( + 24*c10 + 12*c23 + 8*(c11 + c14 + c7 + c9) + 4*c2 + 3*(c20 + c22 + c24 + c27) + 2*(c13 + c15 + c6 + c8) + (c0 + c1 + c3 + c4))
                   + u3*( + 24*c10 + 12*(c14 + c23) + 8*(c11 + c9) + 4*(c27 + c2 + c7) + 3*(c13 + c15 + c22 + c24) + 2*(c20 + c4) + (c1 + c3 + c6 + c8))
            )
            + u0200*(u2*( + 17*(c10 + c23) + 11*(c11 + c24) + 5*(c14 + c20 + c27 + c7) + 3*(c15 + c21 + c28 + c8) + 2*(c22 + c9) + (c2 + c34 + c35 + c3))
                   + u3*( + 17*(c10 + c23) + 11*(c11 + c24) + 7*(c14 + c27) + 5*(c15 + c28) + 3*(c20 + c7) + 2*(c22 + c9) + (c21 + c2 + c34 + c35 + c3 + c8))
            )
            + u0002*(u1*( + 17*(c10 + c23) + 11*(c14 + c27) + 7*(c11 + c24) + 5*(c15 + c28) + 3*(c22 + c9) + 2*(c20 + c7) + (c13 + c26 + c2 + c34 + c36 + c4))
                   + u2*( + 17*(c10 + c23) + 11*(c14 + c27) + 5*(c11 + c22 + c24 + c9) + 3*(c13 + c15 + c26 + c28) + 2*(c20 + c7) + (c2 + c34 + c36 + c4))
            )
            + u2*(u0*(u1*( + 44*c10 + 32*c23 + 20*c11 + 14*(c14 + c7) + 12*c24 + 9*(c20 + c27) + 8*c9 + 6*c22 + 5*(c15 + c8) + 4*c2 + 2*(c21 + c28 + c3) + (c0 + c13 + c4 + c6))
                    + u3*( + 44*c10 + 32*c23 + 20*c14 + 14*(c11 + c9) + 12*c27 + 9*(c22 + c24) + 8*c7 + 6*c20 + 5*(c13 + c15) + 4*c2 + 2*(c26 + c28 + c4) + (c1 + c3 + c6 + c8))
                )
                + u1*u3*( + 38*(c10 + c23) + 16*(c11 + c14 + c24 + c27) + 7*(c20 + c22 + c7 + c9) + 6*(c15 + c28) + 2*(c2 + c34) + (c13 + c21 + c26 + c35 + c36 + c3 + c4 + c8))
            )
        )
        + 8*u3000*( + 12*c10 + 4*(c11 + c14 + c23 + c2 + c7 + c9) + (c0 + c13 + c15 + c1 + c20 + c22 + c24 + c27 + c3 + c4 + c6 + c8)) 
        + 6*u0*u0020*( + 44*c10 + 32*c23 + 14*(c11 + c14 + c7 + c9) + 9*(c20 + c22 + c24 + c27) + 4*c2 + 3*(c13 + c6 + c15 + c8) + (c0 + c19 + c1 + c21 + c26 + c28 + c3 + c4))
        + 4*(u0300*( + 14*(c10 + c11 + c23 + c24) + 4*(c14 + c15 + c20 + c21 + c27 + c28 + c7 + c8) + (c12 + c22 + c25 + c2 + c34 + c35 + c3 + c9) )
           + u0003*( + 14*(c10 + c14 + c23 + c27) + 4*(c11 + c13 + c15 + c22 + c24 + c26 + c28 + c9) + (c17 + c20 + c2 + c30 + c34 + c36 + c4 + c7))
        )
        + 3*u0020*(u1*( + 76*(c10 + c23) + 32*(c11 + c24) + 23*(c14 + c20 + c27 + c7) + 14*(c22 + c9) + 7*(c15 + c21 + c28 + c8) + 4*(c34 + c2) + 2*(c35 + c3) + (c0 + c13 + c19 + c26 + c32 + c36 + c4 + c6))
                 + u3*( + 76*(c10 + c23) + 32*(c14 + c27) + 23*(c11 + c22 + c24 + c9) + 14*(c20 + c7) + 7*(c13 + c15 + c26 + c28) + 4*(c2 + c34) + 2*(c36 + c4) + (c19 + c1 + c21 + c33 + c35 + c3 + c6 + c8))
        )
        + u0030*( + 76*(c10 + c23) + 23*(c11 + c14 + c20 + c22 + c24 + c27 + c7 + c9) + 4*(c13 + c15 + c19 + c21 + c26 + c28 + c2 + c34 + c6 + c8) + (c0 + c1 + c32 + c33 + c35 + c36 + c3 + c4))
        )
    ;
}


float eval_M(void)
{
    u2000 = u0*u0;      // u0^2
    u3000 = u0*u2000;   // u0^3
    u0200 = u1*u1;      // u1^2
    u0300 = u1*u0200;   // u1^3
    u0020 = u2*u2;      // u2^2
    u0030 = u2*u0020;   // u3^3
    u0002 = u3*u3;      // u3^2
    u0003 = u3*u0002;   // u3^3
    return (float(type_tet==TYPE_BLUE )*eval_M_expr_blue()
           +float(type_tet==TYPE_GREEN)*eval_M_expr_green()
           +float(type_tet==TYPE_RED  )*eval_M_expr_red()
           )*ONE_OVER_384;
}


#define u0_2    u2000   // u0^2
#define u1_2    u0200   // u1^2
#define u2_2    u0020   // u2^2
#define u3_2    u0002   // u3^2
//////////////////////////////////////////////////
float eval_Tj_b1() {
    return (
        + 16*u1100*(2*(-c10 - c11 + c27 + c28) + (c14 + c15 - c2 + c23 + c24 - c3 - c7 - c8)) 
        + 8*(u1010*(2*(-c2) + 5*(-c10 + c27) + 3*(-c11 + c28) + (c14 + c15 + c17 + c23 + c24 + c26 - c3 + c30 - c4 - c7 - c8 - c9)) 
           + u0110*(2*(-c7) + 5*(-c10 + c27) + 3*(-c11 + c28) + (c14 + c15 - c2 - c20 + c23 + c24 + c26 - c3 + c34 + c36 - c8 - c9)) 
        )
        + 4*(u2000*(3*(-c10 - c11 + c14 + c15 - c2 + c27 + c28 - c3) + (c17 + c18 + c23 + c24 - c4 - c5 - c7 - c8)) 
           + u0200*(3*(-c10 - c11 + c23 + c24 + c27 + c28 - c7 - c8) + (c14 + c15 - c2 - c20 - c21 - c3 + c34 + c35)) 
           + u0020*(6*(-c10 + c27) + 2*(-c11 + c26 + c28 - c9) + (c17 - c2 - c20 + c30 + c34 + c36 - c4 - c7)) 
           + u1001*(3*(-c2 - c3) + 8*(-c10 - c11 + c27 + c28) + 2*(c14 + c15 + c23 + c24 - c7 - c8) + (-c12 + c17 + c18 + c26 + c29 + c30 + c31 - c4 - c5 - c9)) 
           + u0101*(3*(-c7 - c8) + 8*(-c10 - c11 + c27 + c28) + 2*(c14 + c15 - c2 + c23 + c24 - c3) + (-c12 - c20 - c21 + c26 + c29 + c34 + c35 + c36 + c37 - c9)) 
           + u0011*(10*(-c10 + c27) + 6*(-c11 + c28) + 2*(-c2 + c26 + c30 + c36 - c7 - c9) + (c17 - c20 - c3 + c31 + c34 + c37 - c4 - c8)) 
        )
        + u0002*(16*(-c10 - c11 + c27 + c28) + 2*(-c12 + c26 + c29 - c9) + (c17 + c18 - c20 - c21 + c34 + c35 - c4 - c5) + 3*(-c2 - c3 + c30 + c31 + c36 + c37 - c7 - c8))
    );
}
//////////////////////////////////////////////////
float eval_Tj_b2() {
    return (
        + 8*(u1100*(4*(-c14 - c15 + c23 + c24) + (-c13 - c16 - c2 + c20 + c21 + c22 + c25 - c3 - c4 - c5 + c7 + c8)) 
           + u1010*(2*(-c4) + 5*(-c14 + c23) + 3*(-c15 + c24) + (c10 + c11 - c13 - c17 - c18 - c2 + c20 + c22 + c27 + c28 - c5 + c7)) 
           + u0110*(2*c20 + 5*(-c14 + c23) + 3*(-c15 + c24) + (-c10 - c11 - c13 - c2 + c21 + c22 - c27 - c28 + c34 + c35 - c4 + c7)) 
        )
        + 4*(u2000*(3*(c10 + c11 - c14 - c15 + c23 + c24 - c4 - c5) + (-c17 - c18 - c2 + c27 + c28 - c3 + c7 + c8)) 
           + u0200*(3*(-c10 - c11 - c14 - c15 + c20 + c21 + c23 + c24) + (-c2 - c27 - c28 - c3 + c34 + c35 + c7 + c8)) 
           + u0020*(6*(-c14 + c23) + 2*(-c13 - c15 + c22 + c24) + (-c17 - c2 + c20 - c30 + c34 + c36 - c4 + c7)) 
           + u1001*(3*(-c4 - c5) + 8*(-c14 - c15 + c23 + c24) + 2*(c10 + c11 - c17 - c18 + c27 + c28) + (-c13 - c16 - c2 + c20 + c21 + c22 + c25 - c3 + c7 + c8)) 
           + u0101*(3*(c20 + c21) + 8*(-c14 - c15 + c23 + c24) + 2*(-c10 - c11 - c27 - c28 + c34 + c35) + (-c13 - c16 - c2 + c22 + c25 - c3 - c4 - c5 + c7 + c8)) 
           + u0011*(10*(-c14 + c23) + 6*(-c15 + c24) + 2*(-c13 - c17 + c20 + c22 + c34 - c4) + (-c18 - c2 + c21 - c30 + c35 + c36 - c5 + c7)) 
        )
        + u0002*(2*(-c13 - c16 + c22 + c25) + 16*(-c14 - c15 + c23 + c24) + 3*(-c17 - c18 + c20 + c21 + c34 + c35 - c4 - c5) + (-c2 - c3 - c30 - c31 + c36 + c37 + c7 + c8))
    );
}
//////////////////////////////////////////////////
float eval_Tj_b3() {
    return (
        + 16*u0*u2*(2*(-c10 - c14 + c24 + c28) + (c11 - c13 + c15 - c2 + c23 + c27 - c4 - c9)) 
        + 8*(u1100*(2*(-c2) + 5*(-c10 + c24) + 3*(-c14 + c28) + (c11 + c12 - c13 + c15 + c21 + c23 + c25 + c27 - c3 - c4 - c7 - c9)) 
           + u0110*(2*(-c9) + 5*(-c10 + c24) + 3*(-c14 + c28) + (c11 - c13 + c15 - c2 + c21 - c22 + c23 + c27 + c34 + c35 - c4 - c7)) 
        )
        + 4*(u2000*(3*(-c10 + c11 - c14 + c15 - c2 + c24 + c28 - c4) + (c12 - c13 + c16 + c23 + c27 - c3 - c5 - c9)) 
           + u0200*(6*(-c10 + c24) + 2*(-c14 + c21 + c28 - c7) + (c12 - c2 - c22 + c25 - c3 + c34 + c35 - c9)) 
           + u0020*(3*(-c10 - c13 - c14 + c23 + c24 + c27 + c28 - c9) + (c11 + c15 - c2 - c22 - c26 + c34 + c36 - c4)) 
           + u1001*(3*(-c2 - c4) + 8*(-c10 - c14 + c24 + c28) + 2*(c11 - c13 + c15 + c23 + c27 - c9) + (c12 + c16 - c17 + c21 + c25 + c29 - c3 + c31 - c5 - c7)) 
           + u0101*(10*(-c10 + c24) + 6*(-c14 + c28) + 2*(-c2 + c21 + c25 + c35 - c7 - c9) + (c12 - c13 - c22 + c29 - c3 + c34 + c37 - c4)) 
           + u0011*(3*(-c13 - c9) + 8*(-c10 - c14 + c24 + c28) + 2*(c11 + c15 - c2 + c23 + c27 - c4) + (-c17 + c21 - c22 - c26 + c31 + c34 + c35 + c36 + c37 - c7)) 
        )
        + u0002*(16*(-c10 - c14 + c24 + c28) + 2*(-c17 + c21 + c31 - c7) + (c12 + c16 - c22 - c26 - c3 + c34 + c36 - c5) + 3*(-c13 - c2 + c25 + c29 + c35 + c37 - c4 - c9))
    );
}
//////////////////////////////////////////////////
float eval_Tj_b4() {
    return (
        + 8*(u1100*(2*c3 + 5*(c11 - c23) + 3*(c15 - c27) + (-c10 + c12 - c14 + c16 + c2 - c20 - c22 - c24 - c28 + c5 + c8 - c9)) 
           + u1010*(4*(c11 + c15 - c23 - c27) + (-c13 + c18 + c2 - c20 - c22 - c26 + c3 - c30 + c4 + c5 + c8 - c9)) 
               + u0110*(2*(-c22) + 5*(c11 - c23) + 3*(c15 - c27) + (c10 + c14 + c2 - c20 + c24 - c26 + c28 + c3 - c34 - c36 + c8 - c9)) 
        )
        + 4*(u2000*(3*(-c10 + c11 - c14 + c15 - c23 - c27 + c3 + c5) + (c12 - c13 + c16 + c2 - c24 - c28 + c4 - c9)) 
           + u0200*(6*(c11 - c23) + 2*(c15 - c20 - c27 + c8) + (c12 + c2 - c22 + c25 + c3 - c34 - c35 - c9)) 
           + u0020*(3*(c10 + c11 + c14 + c15 - c22 - c23 - c26 - c27) + (-c13 + c2 + c24 + c28 - c34 - c36 + c4 - c9)) 
           + u1001*(3*(c3 + c5) + 8*(c11 + c15 - c23 - c27) + 2*(-c10 + c12 - c14 + c16 - c24 - c28) + (-c13 + c18 + c2 - c20 - c22 - c26 - c30 + c4 + c8 - c9)) 
           + u0101*(10*(c11 - c23) + 6*(c15 - c27) + 2*(c12 - c20 - c22 + c3 - c34 + c8) + (c16 + c2 + c25 - c26 - c35 - c36 + c5 - c9)) 
           + u0011*(3*(-c22 - c26) + 8*(c11 + c15 - c23 - c27) + 2*(c10 + c14 + c24 + c28 - c34 - c36) + (-c13 + c18 + c2 - c20 + c3 - c30 + c4 + c5 + c8 - c9)) 
        )
        + u0002*(16*(c11 + c15 - c23 - c27) + 2*(c18 - c20 - c30 + c8) + 3*(c12 + c16 - c22 - c26 + c3 - c34 - c36 + c5) + (-c13 + c2 + c25 + c29 - c35 - c37 + c4 - c9))
    );
}
//////////////////////////////////////////////////
float eval_Tj_b5() {
    return (
        + 16*u1*u2*(2*(-c10 + c15 - c23 + c28) + (c11 + c14 - c20 - c22 + c24 + c27 - c7 - c9)) 
        + 8*(u1100*(2*(-c7) + 5*(-c10 + c15) + 3*(-c23 + c28) + (c11 + c12 + c14 + c16 - c2 - c20 - c22 + c24 + c27 + c5 - c8 - c9)) 
              + u1010*(2*(-c9) + 5*(-c10 + c15) + 3*(-c23 + c28) + (c11 - c13 + c14 + c17 + c18 - c2 - c20 - c22 + c24 + c27 + c5 - c7)) 
        )
        + 4*(u2000*(6*(-c10 + c15) + 2*(-c2 - c23 + c28 + c5) + (c12 - c13 + c16 + c17 + c18 - c7 - c8 - c9)) 
           + u0200*(3*(-c10 + c11 + c15 - c20 - c23 + c24 + c28 - c7) + (c12 + c14 - c21 - c22 + c25 + c27 - c8 - c9)) 
           + u0020*(3*(-c10 + c14 + c15 - c22 - c23 + c27 + c28 - c9) + (c11 - c13 + c17 - c20 + c24 - c26 + c30 - c7)) 
           + u1001*(10*(-c10 + c15) + 6*(-c23 + c28) + 2*(c16 + c18 - c2 + c5 - c7 - c9) + (c12 - c13 + c17 - c20 - c22 + c29 + c31 - c8)) 
           + u0101*(3*(-c20 - c7) + 8*(-c10 + c15 - c23 + c28) + 2*(c11 + c14 - c22 + c24 + c27 - c9) + (c12 + c16 - c2 - c21 + c25 + c29 - c34 + c37 + c5 - c8)) 
           + u0011*(3*(-c22 - c9) + 8*(-c10 + c15 - c23 + c28) + 2*(c11 + c14 - c20 + c24 + c27 - c7) + (-c13 + c17 + c18 - c2 - c26 + c30 + c31 - c34 + c37 + c5)) 
        )
        + u0002*(16*(-c10 + c15 - c23 + c28) + 2*(-c2 - c34 + c37 + c5) + (c12 - c13 + c17 - c21 + c25 - c26 + c30 - c8) + 3*(c16 + c18 - c20 - c22 + c29 + c31 - c7 - c9))
    );
}
//////////////////////////////////////////////////
float eval_Tj_b6() {
    return (
        + 8*(u1100*(2*(-c8) + 5*(-c11 + c14) + 3*(-c24 + c27) + (c10 - c12 + c13 + c15 - c21 + c23 - c25 + c28 - c3 + c4 - c7 + c9)) 
           + u1010*(2*c13 + 5*(-c11 + c14) + 3*(-c24 + c27) + (-c10 - c15 + c17 - c23 + c26 - c28 - c3 + c30 + c4 - c7 - c8 + c9)) 
           + u0110*(4*(-c11 + c14 - c24 + c27) + (c13 - c20 - c21 + c22 + c26 - c3 - c35 + c36 + c4 - c7 - c8 + c9)) 
        )
        + 4*(u2000*(6*(-c11 + c14) + 2*(-c24 + c27 - c3 + c4) + (-c12 + c13 - c16 + c17 + c18 - c7 - c8 + c9)) 
           + u0200*(3*(c10 - c11 + c14 - c21 + c23 - c24 + c27 - c8) + (-c12 + c15 - c20 + c22 - c25 + c28 - c7 + c9)) 
           + u0020*(3*(-c10 - c11 + c13 + c14 - c23 - c24 + c26 + c27) + (-c15 + c17 - c20 + c22 - c28 + c30 - c7 + c9)) 
           + u1001*(10*(-c11 + c14) + 6*(-c24 + c27) + 2*(-c12 + c13 + c17 - c3 + c4 - c8) + (-c16 + c18 - c21 - c25 + c26 + c30 - c7 + c9)) 
           + u0101*(3*(-c21 - c8) + 8*(-c11 + c14 - c24 + c27) + 2*(c10 - c12 + c15 + c23 - c25 + c28) + (c13 - c20 + c22 + c26 - c3 - c35 + c36 + c4 - c7 + c9)) 
           + u0011*(3*(c13 + c26) + 8*(-c11 + c14 - c24 + c27) + 2*(-c10 - c15 + c17 - c23 - c28 + c30) + (-c20 - c21 + c22 - c3 - c35 + c36 + c4 - c7 - c8 + c9)) 
        )
        + u0002*(16*(-c11 + c14 - c24 + c27) + 2*(-c3 - c35 + c36 + c4) + 3*(-c12 + c13 + c17 - c21 - c25 + c26 + c30 - c8) + (-c16 + c18 - c20 + c22 - c29 + c31 - c7 + c9))
    );
}
//////////////////////////////////////////////////
float eval_Tj_g1() {
    return 4*(
        + 4*u1*u2*(2*(-c10 - c11 + c27 + c28) + (c14 + c15 - c2 + c23 + c24 - c3 - c7 - c8)) 
        + 2*(u1100*(3*c27 + 4*(c14 - c2) + (-c0 - c1 + c13 + c24 - c8) + 2*(-c10 - c11 + c15 + c23 + c28 - c3 - c7)) 
           + u1010*(3*c27 + 4*(c23 - c7) + (-c0 + c15 + c22 - c3 - c6) + 2*(-c10 - c11 + c14 - c2 + c24 + c28 - c8)) 
           + u1001*(4*(-c10 + c27) + (-c1 + c13 + c15 + c22 + c24 - c3 - c6 - c8) + 2*(-c11 + c14 - c2 + c23 + c26 + c28 - c7 - c9)) 
           + u0101*(2*(-c2) + 5*(-c10 + c27) + 3*(-c11 + c28) + (c14 + c15 + c17 + c23 + c24 + c26 - c3 + c30 - c4 - c7 - c8 - c9)) 
           + u0011*(2*(-c7) + 5*(-c10 + c27) + 3*(-c11 + c28) + (c14 + c15 - c2 - c20 + c23 + c24 + c26 - c3 + c34 + c36 - c8 - c9)) 
        )
        + u2000*(2*(-c0 + c27) + 4*(c14 - c2 + c23 - c7) + (-c1 + c13 + c15 + c22 + c24 - c3 - c6 - c8)) 
        + u0200*(3*(-c10 - c11 + c14 + c15 - c2 + c27 + c28 - c3) + (c17 + c18 + c23 + c24 - c4 - c5 - c7 - c8)) 
        + u0020*(3*(-c10 - c11 + c23 + c24 + c27 + c28 - c7 - c8) + (c14 + c15 - c2 - c20 - c21 - c3 + c34 + c35)) 
        + u0002*(6*(-c10 + c27) + 2*(-c11 + c26 + c28 - c9) + (c17 - c2 - c20 + c30 + c34 + c36 - c4 - c7))
    );
}
//////////////////////////////////////////////////
float eval_Tj_g2() {
    return 4*(
        + 4*u0*u3*(3*(-c14 + c23) + (-c13 - c15 - c2 + c20 + c22 + c24 - c4 + c7)) 
        + 2*(u1100*(3*(-c4) + 4*(-c14 + c23) + (-c13 + c20 + c22 - c3 + c8) + 2*(c10 + c11 - c15 - c2 + c24 - c5 + c7)) 
           + u0110*(4*(-c14 - c15 + c23 + c24) + (-c13 - c16 - c2 + c20 + c21 + c22 + c25 - c3 - c4 - c5 + c7 + c8)) 
           + u0101*(2*(-c4) + 5*(-c14 + c23) + 3*(-c15 + c24) + (c10 + c11 - c13 - c17 - c18 - c2 + c20 + c22 + c27 + c28 - c5 + c7)) 
           + u1010*(3*c20 + 4*(-c14 + c23) + (-c13 + c22 - c3 - c4 + c8) + 2*(-c10 - c11 - c15 - c2 + c21 + c24 + c7)) 
           + u0011*(2*c20 + 5*(-c14 + c23) + 3*(-c15 + c24) + (-c10 - c11 - c13 - c2 + c21 + c22 - c27 - c28 + c34 + c35 - c4 + c7)) 
        )
        + u2000*(2*(c20 - c4) + 4*(-c14 - c2 + c23 + c7) + (-c1 - c13 - c15 + c22 + c24 - c3 + c6 + c8)) 
        + u0200*(3*(c10 + c11 - c14 - c15 + c23 + c24 - c4 - c5) + (-c17 - c18 - c2 + c27 + c28 - c3 + c7 + c8)) 
        + u0020*(3*(-c10 - c11 - c14 - c15 + c20 + c21 + c23 + c24) + (-c2 - c27 - c28 - c3 + c34 + c35 + c7 + c8)) 
        + u0002*(6*(-c14 + c23) + 2*(-c13 - c15 + c22 + c24) + (-c17 - c2 + c20 - c30 + c34 + c36 - c4 + c7))
    );
}
//////////////////////////////////////////////////
float eval_Tj_g3() {
    return 4*(
        + 4*u0101*(2*(-c10 - c14 + c24 + c28) + (c11 - c13 + c15 - c2 + c23 + c27 - c4 - c9)) 
        + 2*(u1100*(3*c24 + 4*(c11 - c2) + (-c0 - c1 - c13 + c27 + c8) + 2*(-c10 - c14 + c15 + c23 + c28 - c4 - c9)) 
           + u1010*(4*(-c10 + c24) + (-c0 - c13 + c15 + c20 + c27 - c4 - c6 + c8) + 2*(c11 - c14 - c2 + c21 + c23 + c28 - c7 - c9)) 
           + u1001*(3*c24 + 4*(c23 - c9) + (-c1 + c15 + c20 - c4 - c6) + 2*(-c10 + c11 - c13 - c14 - c2 + c27 + c28)) 
           + u0110*(2*(-c2) + 5*(-c10 + c24) + 3*(-c14 + c28) + (c11 + c12 - c13 + c15 + c21 + c23 + c25 + c27 - c3 - c4 - c7 - c9)) 
           + u0011*(2*(-c9) + 5*(-c10 + c24) + 3*(-c14 + c28) + (c11 - c13 + c15 - c2 + c21 - c22 + c23 + c27 + c34 + c35 - c4 - c7)) 
        )
        + u2000*(2*(-c1 + c24) + 4*(c11 - c2 + c23 - c9) + (-c0 - c13 + c15 + c20 + c27 - c4 - c6 + c8)) 
        + u0200*(3*(-c10 + c11 - c14 + c15 - c2 + c24 + c28 - c4) + (c12 - c13 + c16 + c23 + c27 - c3 - c5 - c9)) 
        + u0020*(6*(-c10 + c24) + 2*(-c14 + c21 + c28 - c7) + (c12 - c2 - c22 + c25 - c3 + c34 + c35 - c9)) 
        + u0002*(3*(-c10 - c13 - c14 + c23 + c24 + c27 + c28 - c9) + (c11 + c15 - c2 - c22 - c26 + c34 + c36 - c4))
    );
}
//////////////////////////////////////////////////
float eval_Tj_g4() {
    return 4*(
        + 4*u1010*(3*(c11 - c23) + (c15 + c2 - c20 - c22 - c27 + c3 + c8 - c9)) 
        + 2*(u1100*(3*c3 + 4*(c11 - c23) + (-c13 - c20 - c22 + c4 + c8) + 2*(-c10 - c14 + c15 + c2 - c27 + c5 - c9)) 
           + u0110*(2*c3 + 5*(c11 - c23) + 3*(c15 - c27) + (-c10 + c12 - c14 + c16 + c2 - c20 - c22 - c24 - c28 + c5 + c8 - c9)) 
           + u0101*(4*(c11 + c15 - c23 - c27) + (-c13 + c18 + c2 - c20 - c22 - c26 + c3 - c30 + c4 + c5 + c8 - c9)) 
           + u1001*(3*(-c22) + 4*(c11 - c23) + (-c13 - c20 + c3 + c4 + c8) + 2*(c10 + c14 + c15 + c2 - c26 - c27 - c9)) 
           + u0011*(2*(-c22) + 5*(c11 - c23) + 3*(c15 - c27) + (c10 + c14 + c2 - c20 + c24 - c26 + c28 + c3 - c34 - c36 + c8 - c9)) 
        )
        + u2000*(2*(-c22 + c3) + 4*(c11 + c2 - c23 - c9) + (c0 - c13 + c15 - c20 - c27 + c4 - c6 + c8)) 
        + u0200*(3*(-c10 + c11 - c14 + c15 - c23 - c27 + c3 + c5) + (c12 - c13 + c16 + c2 - c24 - c28 + c4 - c9)) 
        + u0020*(6*(c11 - c23) + 2*(c15 - c20 - c27 + c8) + (c12 + c2 - c22 + c25 + c3 - c34 - c35 - c9)) 
        + u0002*(3*(c10 + c11 + c14 + c15 - c22 - c23 - c26 - c27) + (-c13 + c2 + c24 + c28 - c34 - c36 + c4 - c9))
    );
}
//////////////////////////////////////////////////
float eval_Tj_g5() {
    return 4*(
        + 4*u2*u3*(2*(-c10 + c15 - c23 + c28) + (c11 + c14 - c20 - c22 + c24 + c27 - c7 - c9)) 
        + 2*(u1100*(4*(-c10 + c15) + (-c0 - c1 - c20 - c22 + c24 + c27 + c3 + c4) + 2*(c11 + c14 - c2 - c23 + c28 + c5 - c7 - c9)) 
           + u1010*(3*c15 + 4*(c11 - c7) + (-c0 - c22 + c27 + c3 - c6) + 2*(-c10 + c14 - c20 - c23 + c24 + c28 - c9)) 
           + u1001*(3*c15 + 4*(c14 - c9) + (-c1 - c20 + c24 + c4 - c6) + 2*(-c10 + c11 - c22 - c23 + c27 + c28 - c7)) 
           + u0110*(2*(-c7) + 5*(-c10 + c15) + 3*(-c23 + c28) + (c11 + c12 + c14 + c16 - c2 - c20 - c22 + c24 + c27 + c5 - c8 - c9)) 
           + u0101*(2*(-c9) + 5*(-c10 + c15) + 3*(-c23 + c28) + (c11 - c13 + c14 + c17 + c18 - c2 - c20 - c22 + c24 + c27 + c5 - c7)) 
        )
        + u2000*(2*(c15 - c6) + 4*(c11 + c14 - c7 - c9) + (-c0 - c1 - c20 - c22 + c24 + c27 + c3 + c4)) 
        + u0200*(6*(-c10 + c15) + 2*(-c2 - c23 + c28 + c5) + (c12 - c13 + c16 + c17 + c18 - c7 - c8 - c9)) 
        + u0020*(3*(-c10 + c11 + c15 - c20 - c23 + c24 + c28 - c7) + (c12 + c14 - c21 - c22 + c25 + c27 - c8 - c9)) 
        + u0002*(3*(-c10 + c14 + c15 - c22 - c23 + c27 + c28 - c9) + (c11 - c13 + c17 - c20 + c24 - c26 + c30 - c7))
    );
}
//////////////////////////////////////////////////
float eval_Tj_g6() {
    return 4*(
        + 4*u0*u1*(3*(-c11 + c14) + (c13 - c24 + c27 - c3 + c4 - c7 - c8 + c9)) 
        + 2*(u1010*(3*(-c8) + 4*(-c11 + c14) + (c13 - c20 + c22 - c3 + c4) + 2*(c10 - c21 + c23 - c24 + c27 - c7 + c9)) 
           + u0110*(2*(-c8) + 5*(-c11 + c14) + 3*(-c24 + c27) + (c10 - c12 + c13 + c15 - c21 + c23 - c25 + c28 - c3 + c4 - c7 + c9)) 
           + u1001*(3*c13 + 4*(-c11 + c14) + (-c20 + c22 - c3 + c4 - c8) + 2*(-c10 - c23 - c24 + c26 + c27 - c7 + c9)) 
           + u0101*(2*c13 + 5*(-c11 + c14) + 3*(-c24 + c27) + (-c10 - c15 + c17 - c23 + c26 - c28 - c3 + c30 + c4 - c7 - c8 + c9)) 
           + u0011*(4*(-c11 + c14 - c24 + c27) + (c13 - c20 - c21 + c22 + c26 - c3 - c35 + c36 + c4 - c7 - c8 + c9)) 
        )
        + u2000*(2*(c13 - c8) + 4*(-c11 + c14 - c7 + c9) + (-c0 + c1 - c20 + c22 - c24 + c27 - c3 + c4)) 
        + u0200*(6*(-c11 + c14) + 2*(-c24 + c27 - c3 + c4) + (-c12 + c13 - c16 + c17 + c18 - c7 - c8 + c9)) 
        + u0020*(3*(c10 - c11 + c14 - c21 + c23 - c24 + c27 - c8) + (-c12 + c15 - c20 + c22 - c25 + c28 - c7 + c9)) 
        + u0002*(3*(-c10 - c11 + c13 + c14 - c23 - c24 + c26 + c27) + (-c15 + c17 - c20 + c22 - c28 + c30 - c7 + c9))
    );
}
//////////////////////////////////////////////////
float eval_Tj_r1() {
    return (
        + 8*(u1100*(3*c27 + 4*(c23 - c7) + (-c0 + c15 + c22 - c3 - c6) + 2*(-c10 - c11 + c14 - c2 + c24 + c28 - c8)) 
           + u1001*(4*(-c10 + c27) + (-c1 + c13 + c15 + c22 + c24 - c3 - c6 - c8) + 2*(-c11 + c14 - c2 + c23 + c26 + c28 - c7 - c9)) 
           + u0101*(2*(-c7) + 5*(-c10 + c27) + 3*(-c11 + c28) + (c14 + c15 - c2 - c20 + c23 + c24 + c26 - c3 + c34 + c36 - c8 - c9)) 
        )
        + 4*(u2000*(2*(-c0 + c27) + 4*(c14 - c2 + c23 - c7) + (-c1 + c13 + c15 + c22 + c24 - c3 - c6 - c8)) 
           + u0200*(3*(-c10 - c11 + c23 + c24 + c27 + c28 - c7 - c8) + (c14 + c15 - c2 - c20 - c21 - c3 + c34 + c35)) 
           + u0002*(6*(-c10 + c27) + 2*(-c11 + c26 + c28 - c9) + (c17 - c2 - c20 + c30 + c34 + c36 - c4 - c7))
           + u1010*(6*c27 + 8*(c23 - c7) + 4*(-c10 + c14 - c2) + (-c1 + c13 + c15 - c3) + 3*(c22 + c24 - c6 - c8) + 2*(-c0 - c11 + c26 + c28 - c9)) 
           + u0110*(6*(-c10 + c23) + 7*(c27 - c7) + 4*(-c11 + c24 + c28 - c8) + 2*(c14 - c2 - c20 + c34) + (-c0 + c15 - c21 + c22 + c26 - c3 + c35 + c36 - c6 - c9)) 
           + u0011*(10*(-c10 + c27) + 4*(-c11 + c26 + c28 - c7 - c9) + 2*(c14 - c2 - c20 + c23 + c34 + c36) + (-c1 + c13 + c15 + c22 + c24 - c3 - c6 - c8)) 
        )
        + u0020*(2*(-c0 + c36) + 12*(-c10 + c23) + 14*(c27 - c7) + 4*(c14 - c2 - c20 + c34) + (-c1 + c13 + c15 - c19 - c21 - c3 + c33 + c35) + 5*(-c11 + c22 + c24 + c26 + c28 - c6 - c8 - c9)) 
    );
}
//////////////////////////////////////////////////
float eval_Tj_r2() {
    return (
        + 16*u1001*(3*(-c14 + c23) + (-c13 - c15 - c2 + c20 + c22 + c24 - c4 + c7)) 
        + 8*(u1100*(3*c20 + 4*(-c14 + c23) + (-c13 + c22 - c3 - c4 + c8) + 2*(-c10 - c11 - c15 - c2 + c21 + c24 + c7)) 
           + u0101*(2*c20 + 5*(-c14 + c23) + 3*(-c15 + c24) + (-c10 - c11 - c13 - c2 + c21 + c22 - c27 - c28 + c34 + c35 - c4 + c7)) 
        )
        + 4*(u2000*(2*(c20 - c4) + 4*(-c14 - c2 + c23 + c7) + (-c1 - c13 - c15 + c22 + c24 - c3 + c6 + c8)) 
           + u0200*(3*(-c10 - c11 - c14 - c15 + c20 + c21 + c23 + c24) + (-c2 - c27 - c28 - c3 + c34 + c35 + c7 + c8)) 
           + u0002*(6*(-c14 + c23) + 2*(-c13 - c15 + c22 + c24) + (-c17 - c2 + c20 - c30 + c34 + c36 - c4 + c7))
           + u1010*(6*c20 + 8*(-c14 + c23) + 4*(-c10 - c2 + c7) + (-c1 - c3 + c6 + c8) + 3*(-c13 - c15 + c22 + c24) + 2*(-c11 + c19 + c21 - c4 - c9)) 
           + u0110*(6*(-c10 + c23) + 7*(-c14 + c20) + 4*(-c11 - c15 + c21 + c24) + 2*(-c2 - c27 + c34 + c7) + (-c13 + c19 + c22 - c28 - c3 + c32 + c35 - c4 + c8 - c9)) 
           + u0011*(10*(-c14 + c23) + 4*(-c13 - c15 + c20 + c22 + c24) + 2*(-c10 - c2 - c27 + c34 - c4 + c7) + (-c11 + c19 + c21 - c26 - c28 + c33 + c35 - c9)) 
        )
        + u0020*(12*(-c10 + c23) + 14*(-c14 + c20) + 2*(c32 - c4) + 4*(-c2 - c27 + c34 + c7) + (-c1 - c26 - c28 - c3 + c33 + c35 + c6 + c8) + 5*(-c11 - c13 - c15 + c19 + c21 + c22 + c24 - c9)) 
    );
}
//////////////////////////////////////////////////
float eval_Tj_r3() {
    return (
        + 8*(u1100*(4*(-c10 + c24) + (-c0 - c13 + c15 + c20 + c27 - c4 - c6 + c8) + 2*(c11 - c14 - c2 + c21 + c23 + c28 - c7 - c9)) 
           + u1001*(3*c24 + 4*(c23 - c9) + (-c1 + c15 + c20 - c4 - c6) + 2*(-c10 + c11 - c13 - c14 - c2 + c27 + c28)) 
           + u0101*(2*(-c9) + 5*(-c10 + c24) + 3*(-c14 + c28) + (c11 - c13 + c15 - c2 + c21 - c22 + c23 + c27 + c34 + c35 - c4 - c7)) 
        )
        + 4*(u2000*(2*(-c1 + c24) + 4*(c11 - c2 + c23 - c9) + (-c0 - c13 + c15 + c20 + c27 - c4 - c6 + c8)) 
           + u0200*(6*(-c10 + c24) + 2*(-c14 + c21 + c28 - c7) + (c12 - c2 - c22 + c25 - c3 + c34 + c35 - c9)) 
           + u0002*(3*(-c10 - c13 - c14 + c23 + c24 + c27 + c28 - c9) + (c11 + c15 - c2 - c22 - c26 + c34 + c36 - c4))
           + u1010*(6*c24 + 8*(c23 - c9) + 4*(-c10 + c11 - c2) + (-c0 + c15 - c4 + c8) + 3*(-c13 + c20 + c27 - c6) + 2*(-c1 - c14 + c21 + c28 - c7)) 
           + u0110*(10*(-c10 + c24) + 4*(-c14 + c21 + c28 - c7 - c9) + 2*(c11 - c2 - c22 + c23 + c34 + c35) + (-c0 - c13 + c15 + c20 + c27 - c4 - c6 + c8)) 
           + u0011*(6*(-c10 + c23) + 7*(c24 - c9) + 2*(c11 - c2 - c22 + c34) + 4*(-c13 - c14 + c27 + c28) + (-c1 + c15 + c20 + c21 - c26 + c35 + c36 - c4 - c6 - c7)) 
        )
        + u0020*(2*(-c1 + c35) + 12*(-c10 + c23) + 14*(c24 - c9) + 4*(c11 - c2 - c22 + c34) + (-c0 + c15 - c19 - c26 + c32 + c36 - c4 + c8) + 5*(-c13 - c14 + c20 + c21 + c27 + c28 - c6 - c7)) 
    );
}
//////////////////////////////////////////////////
float eval_Tj_r4() {
    return (
        + 16*u1100*(3*(c11 - c23) + (c15 + c2 - c20 - c22 - c27 + c3 + c8 - c9)) 
        + 8*(u1001*(3*(-c22) + 4*(c11 - c23) + (-c13 - c20 + c3 + c4 + c8) + 2*(c10 + c14 + c15 + c2 - c26 - c27 - c9)) 
           + u0101*(2*(-c22) + 5*(c11 - c23) + 3*(c15 - c27) + (c10 + c14 + c2 - c20 + c24 - c26 + c28 + c3 - c34 - c36 + c8 - c9)) 
        )
        + 4*(u2000*(2*(-c22 + c3) + 4*(c11 + c2 - c23 - c9) + (c0 - c13 + c15 - c20 - c27 + c4 - c6 + c8)) 
           + u0200*(6*(c11 - c23) + 2*(c15 - c20 - c27 + c8) + (c12 + c2 - c22 + c25 + c3 - c34 - c35 - c9)) 
           + u0002*(3*(c10 + c11 + c14 + c15 - c22 - c23 - c26 - c27) + (-c13 + c2 + c24 + c28 - c34 - c36 + c4 - c9))
           + u1010*(6*(-c22) + 8*(c11 - c23) + 4*(c10 + c2 - c9) + (c0 - c13 + c4 - c6) + 3*(c15 - c20 - c27 + c8) + 2*(c14 - c19 - c26 + c3 + c7)) 
           + u0110*(10*(c11 - c23) + 4*(c15 - c20 - c22 - c27 + c8) + 2*(c10 + c2 + c24 + c3 - c34 - c9) + (c14 - c19 + c21 - c26 + c28 - c32 - c36 + c7)) 
           + u0011*(6*(c10 - c23) + 7*(c11 - c22) + 4*(c14 + c15 - c26 - c27) + 2*(c2 + c24 - c34 - c9) + (-c13 - c19 - c20 + c28 + c3 - c33 - c36 + c4 + c7 + c8)) 
        )
        + u0020*(12*(c10 - c23) + 14*(c11 - c22) + 2*(c3 - c33) + 4*(c2 + c24 - c34 - c9) + (c0 - c13 + c21 + c28 - c32 - c36 + c4 - c6) + 5*(c14 + c15 - c19 - c20 - c26 - c27 + c7 + c8)) 
    );
}
//////////////////////////////////////////////////
float eval_Tj_r5() {
    return (
        + 16*u0101*(2*(-c10 + c15 - c23 + c28) + (c11 + c14 - c20 - c22 + c24 + c27 - c7 - c9)) 
        + 8*(u1100*(3*c15 + 4*(c11 - c7) + (-c0 - c22 + c27 + c3 - c6) + 2*(-c10 + c14 - c20 - c23 + c24 + c28 - c9)) 
           + u1001*(3*c15 + 4*(c14 - c9) + (-c1 - c20 + c24 + c4 - c6) + 2*(-c10 + c11 - c22 - c23 + c27 + c28 - c7)) 
        )
        + 4*(u2000*(2*(c15 - c6) + 4*(c11 + c14 - c7 - c9) + (-c0 - c1 - c20 - c22 + c24 + c27 + c3 + c4)) 
           + u0200*(3*(-c10 + c11 + c15 - c20 - c23 + c24 + c28 - c7) + (c12 + c14 - c21 - c22 + c25 + c27 - c8 - c9)) 
           + u0002*(3*(-c10 + c14 + c15 - c22 - c23 + c27 + c28 - c9) + (c11 - c13 + c17 - c20 + c24 - c26 + c30 - c7))
           + u1010*(4*(c15 - c6) + 2*(-c19 + c28) + (-c0 - c1 + c3 + c4) + 6*(c11 + c14 - c7 - c9) + 3*(-c20 - c22 + c24 + c27)) 
           + u0110*(4*(-c10 - c23) + 5*(c15 + c28) + 6*(c11 - c20 + c24 - c7) + 3*(c14 - c22 + c27 - c9) + (-c0 - c19 + c3 - c32 + c35 - c6)) 
           + u0011*(4*(-c10 - c23) + 5*(c15 + c28) + 3*(c11 - c20 + c24 - c7) + 6*(c14 - c22 + c27 - c9) + (-c1 - c19 - c33 + c36 + c4 - c6)) 
        )
        + u0020*(6*(c15 - c19 + c28 - c6) + (-c0 - c1 + c3 - c32 - c33 + c35 + c36 + c4) + 9*(c11 + c14 - c20 - c22 + c24 + c27 - c7 - c9)) 
    );
}
//////////////////////////////////////////////////
float eval_Tj_r6() {
    return (
        + 8*(u1100*(3*(-c8) + 4*(-c11 + c14) + (c13 - c20 + c22 - c3 + c4) + 2*(c10 - c21 + c23 - c24 + c27 - c7 + c9)) 
           + u1001*(3*c13 + 4*(-c11 + c14) + (-c20 + c22 - c3 + c4 - c8) + 2*(-c10 - c23 - c24 + c26 + c27 - c7 + c9)) 
           + u0101*(4*(-c11 + c14 - c24 + c27) + (c13 - c20 - c21 + c22 + c26 - c3 - c35 + c36 + c4 - c7 - c8 + c9)) 
        )
        + 4*(u2000*(2*(c13 - c8) + 4*(-c11 + c14 - c7 + c9) + (-c0 + c1 - c20 + c22 - c24 + c27 - c3 + c4)) 
           + u0200*(3*(c10 - c11 + c14 - c21 + c23 - c24 + c27 - c8) + (-c12 + c15 - c20 + c22 - c25 + c28 - c7 + c9)) 
           + u0002*(3*(-c10 - c11 + c13 + c14 - c23 - c24 + c26 + c27) + (-c15 + c17 - c20 + c22 - c28 + c30 - c7 + c9))
           + u1010*(4*(c13 - c8) + 2*(-c21 + c26) + (-c0 + c1 - c3 + c4) + 6*(-c11 + c14 - c7 + c9) + 3*(-c20 + c22 - c24 + c27)) 
           + u0110*(4*(c10 + c23) + 5*(-c21 - c8) + 6*(-c11 + c14 - c24 + c27) + 3*(-c20 + c22 - c7 + c9) + (c13 + c26 - c3 - c35 + c36 + c4)) 
           + u0011*(4*(-c10 - c23) + 5*(c13 + c26) + 6*(-c11 + c14 - c24 + c27) + 3*(-c20 + c22 - c7 + c9) + (-c21 - c3 - c35 + c36 + c4 - c8)) 
        )
        + u0020*(6*(c13 - c21 + c26 - c8) + (-c0 + c1 - c3 - c32 + c33 - c35 + c36 + c4) + 9*(-c11 + c14 - c20 + c22 - c24 + c27 - c7 + c9)) 
    );
}
//////////////////////////////////////////////////////////
// Tij
//////////////////////////////////////////////////////////
//////////////////////////////////////////////////
float eval_Tij_b1() {
    return (
        2*(u0*(c10 - c11 - c12 - c13 + c14 + c15 - c16 + c18 + c23 + c24 - c26 - c27 + c28 - c3 - c30 + c4) 
         + u1*(c10 - c11 - c12 + c14 + c15 + c20 - c22 + c23 + c24 - c25 - c26 - c27 + c28 + c35 - c36 - c8) 
         + u2*(2*(c10 - c11 + c14 + c23 - c26) + (-c13 + c20 - c22 - c3 + c4 - c8)) 
        )
        + u3*(2*(c10 - c11 - c12 + c14 + c15 + c23 + c24 - c26 - c27 + c28) + (-c13 - c16 + c18 + c20 - c22 - c25 - c3 - c30 + c35 - c36 + c4 - c8))
    );
}
//////////////////////////////////////////////////
float eval_Tij_b2() {
    return (
        2*(u0*(-c10 + c11 - c13 + c14 + c15 - c16 + c17 - c2 + c23 + c24 + c27 - c28 - c29 - c31 + c5 - c9) 
         + u1*(-c10 + c11 + c14 + c15 + c21 - c22 + c23 + c24 - c25 + c27 - c28 - c29 + c34 - c37 - c7 - c9) 
         + u2*(2*(c14 + c23 + c27 - c28 - c9) + (-c13 + c17 - c22 - c31 + c34 - c37)) 
        )
        + u3*(2*(-c10 + c11 + c14 + c15 + c23 + c24 + c27 - c28 - c29 - c9) + (-c13 - c16 + c17 - c2 + c21 - c22 - c25 - c31 + c34 - c37 + c5 - c7))
    );
}
//////////////////////////////////////////////////
float eval_Tij_b3() {
    return (
        2*((u0+u1)*(c10 + c11 - c12 + c14 - c15 - c16 + c2 - c20 - c22 - c23 + c24 + c27 + c28 - c5 + c8 - c9) 
          + u2*(2*(c10 + c14 - c15 - c22 + c27) + (-c18 + c2 - c26 + c30 - c5 - c9)) 
        )
        + u3*(2*(c10 + c11 + c14 - c15 - c16 - c22 - c23 + c24 + c27 + c28) + (-c12 - c18 + c2 - c20 - c26 - c29 + c30 - c34 + c37 - c5 + c8 - c9))
    );
}
//////////////////////////////////////////////////
float eval_Tij_b4() {
    return (
        2*((u0+u1)*(c10 + c11 - c12 - c13 - c14 + c15 - c21 + c23 - c24 - c25 + c27 + c28 + c3 - c4 + c7 - c9) 
          + u2*(2*(c10 - c13 + c23 - c24 + c27) + (-c21 - c26 - c35 + c36 + c7 - c9)) 
        )
        + u3*(2*(c10 + c11 - c13 - c14 + c15 + c23 - c24 - c25 + c27 + c28) + (-c12 - c17 - c21 - c26 - c29 + c3 + c31 - c35 + c36 - c4 + c7 - c9))
    );
}
//////////////////////////////////////////////////
float eval_Tij_b5() {
    return (
        2*(u0*(c10 + c11 - c14 + c15 + c16 - c17 - c18 - c21 + c23 - c24 - c25 + c27 + c28 + c3 - c4 - c8) 
         + u1*(2*(c10 + c11 - c14 - c21 + c23) + (-c13 - c20 + c22 + c3 - c4 - c8)) 
         + u2*(c10 + c11 - c13 - c14 + c15 - c17 - c20 - c21 + c22 + c23 - c24 + c27 + c28 - c30 - c35 + c36) 
        )
        + u3*(2*(c10 + c11 - c14 + c15 - c17 - c21 + c23 - c24 + c27 + c28) + (-c13 + c16 - c18 - c20 + c22 - c25 + c3 - c30 - c35 + c36 - c4 - c8))
    );
}
//////////////////////////////////////////////////
float eval_Tij_b6() {
    return (
        2*(u0*(-c10 + c11 + c12 + c14 + c15 - c18 - c2 + c23 + c24 + c27 - c28 - c29 - c31 + c5 - c7 - c8) 
         + u1*(2*(c11 + c23 + c24 - c28 - c7) + (c12 - c20 - c29 + c34 - c37 - c8)) 
         + u2*(-c10 + c11 + c14 + c15 - c20 + c23 + c24 + c26 + c27 - c28 - c30 - c31 + c34 - c37 - c7 - c9) 
        )
        + u3*(2*(-c10 + c11 + c14 + c15 + c23 + c24 + c27 - c28 - c31 - c7) + (c12 - c18 - c2 - c20 + c26 - c29 - c30 + c34 - c37 + c5 - c8 - c9))
    );
}
//////////////////////////////////////////////////
float eval_Tij_b7() {
    return (
        2*((u0+u2)*(c10 - c11 + c14 + c15 - c17 + c23 + c24 - c26 - c27 + c28 - c3 - c30 + c4 - c7 - c8 + c9) 
          + u1*(2*(c10 + c23 + c24 - c27 - c8) + (-c21 - c26 + c35 - c36 - c7 + c9)) 
        )
        + u3*(2*(c10 - c11 + c14 + c15 + c23 + c24 - c27 + c28 - c30 - c8) + (-c12 - c17 - c21 - c26 + c29 - c3 - c31 + c35 - c36 + c4 - c7 + c9))
    );
}
//////////////////////////////////////////////////
float eval_Tij_b8() {
    return (
        2*((u0+u2)*(c10 + c11 + c13 + c14 - c15 - c17 - c18 + c2 - c20 - c22 - c23 + c24 + c27 + c28 - c5 - c7) 
          + u1*(2*(c10 + c11 - c15 - c20 + c24) + (-c16 + c2 - c21 + c25 - c5 - c7)) 
        )
        + u3*(2*(c10 + c11 + c14 - c15 - c18 - c20 - c23 + c24 + c27 + c28) + (c13 - c16 - c17 + c2 - c21 - c22 + c25 - c31 - c34 + c37 - c5 - c7))
    );
}
//////////////////////////////////////////////////
float eval_Tij_b9() {
    return (
        + 2*(u0*(2*(c10 + c11 + c14 - c23 - c5) + (c13 - c20 - c22 - c3 - c4 + c8)) 
           + u1*(c10 + c11 + c14 - c15 - c16 - c20 - c23 + c24 + c25 + c27 + c28 - c3 - c34 - c35 - c5 + c8) 
           + u2*(c10 + c11 + c13 + c14 - c15 - c18 - c22 - c23 + c24 + c27 + c28 + c30 - c34 - c36 - c4 - c5) 
        )
        + u3*(2*(c10 + c11 + c14 - c15 - c23 + c24 + c27 + c28 - c34 - c5) + (c13 - c16 - c18 - c20 - c22 + c25 - c3 + c30 - c35 - c36 - c4 + c8))
    );
}
//////////////////////////////////////////////////
float eval_Tij_b10() {
    return (
        2*(u0*(2*(c11 + c14 + c15 - c2 - c28) + (c12 + c17 - c29 - c3 - c31 - c4)) 
         + u1*(-c10 + c11 + c12 + c14 + c15 - c2 + c21 + c23 + c24 + c27 - c28 - c29 - c3 - c35 - c37 - c7) 
         + u2*(-c10 + c11 + c14 + c15 + c17 - c2 + c23 + c24 + c26 + c27 - c28 - c31 - c36 - c37 - c4 - c9) 
        )
        + u3*(2*(-c10 + c11 + c14 + c15 - c2 + c23 + c24 + c27 - c28 - c37) + (c12 + c17 + c21 + c26 - c29 - c3 - c31 - c35 - c36 - c4 - c7 - c9))
    );
}
//////////////////////////////////////////////////
float eval_Tij_b11() {
    return (
        2*(u0*(2*(c10 + c11 + c15 - c24 - c4) + (c16 - c2 - c21 - c25 - c5 + c7)) 
         + (u1+u2)*(c10 + c11 - c13 - c14 + c15 - c2 - c21 + c22 + c23 - c24 + c27 + c28 - c34 - c35 - c4 + c7) 
        )
        + u3*(2*(c10 + c11 - c14 + c15 + c23 - c24 + c27 + c28 - c35 - c4) + (-c13 + c16 - c17 - c2 - c21 + c22 - c25 + c31 - c34 - c37 - c5 + c7))
    );
}
//////////////////////////////////////////////////
float eval_Tij_b12() {
    return (
        2*(u0*(2*(c10 + c14 + c15 - c27 - c3) + (c18 - c2 - c26 - c30 - c5 + c9)) 
           + (u1+u2)*(c10 - c11 + c14 + c15 - c2 + c20 + c23 + c24 - c26 - c27 + c28 - c3 - c34 - c36 - c8 + c9) 
        )
        + u3*(2*(c10 - c11 + c14 + c15 + c23 + c24 - c27 + c28 - c3 - c36) + (-c12 + c18 - c2 + c20 - c26 + c29 - c30 - c34 - c37 - c5 - c8 + c9))
    );
}
//////////////////////////////////////////////////
float eval_Tij_g1() {
    return 2*(
          (u0+u3)*(2*(c10 - c11 + c14 + c23 - c26) + (-c13 + c20 - c22 - c3 + c4 - c8)) 
        + u1*(c10 - c11 - c12 - c13 + c14 + c15 - c16 + c18 + c23 + c24 - c26 - c27 + c28 - c3 - c30 + c4) 
        + u2*(c10 - c11 - c12 + c14 + c15 + c20 - c22 + c23 + c24 - c25 - c26 - c27 + c28 + c35 - c36 - c8) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_g2() {
    return 2*(
          (u0+u3)*(2*(c10 + c14 + c23 - c28 - c9) + (-c1 - c15 + c20 - c24 + c4 - c6)) 
        + u1*(-c0 - c1 + c10 + c11 - c12 + c14 - c15 - c16 - c2 + c23 - c28 + c3 + c4 + c5 + c8 - c9) 
        + u2*(-c0 + c10 + c11 - c12 + c14 + c20 + c21 + c23 - c24 - c25 - c28 + c3 - c6 - c7 + c8 - c9) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_g3() {
    return 2*(
          u0*(2*(c10 + c14 + c2 - c5 - c9) + (c0 - c15 - c22 + c27 - c3 - c6)) 
        + u3*(2*(c10 + c14 - c15 - c22 + c27) + (-c18 + c2 - c26 + c30 - c5 - c9))
        + (u1+u2)*(c10 + c11 - c12 + c14 - c15 - c16 + c2 - c20 - c22 - c23 + c24 + c27 + c28 - c5 + c8 - c9) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_g4() {
    return 2*(
        u0*(2*(c10 - c21 + c23 + c7 - c9) + (c0 - c1 - c13 - c24 + c27 - c8)) 
        + (u1+u2)*(c10 + c11 - c12 - c13 - c14 + c15 - c21 + c23 - c24 - c25 + c27 + c28 + c3 - c4 + c7 - c9) 
        + u3*(2*(c10 - c13 + c23 - c24 + c27) + (-c21 - c26 - c35 + c36 + c7 - c9))
    );
}
//////////////////////////////////////////////////
float eval_Tij_g5() {
    return 2*(    
          (u0+u2)*(2*(c10 + c11 - c14 - c21 + c23) + (-c13 - c20 + c22 + c3 - c4 - c8)) 
        + u1*(c10 + c11 - c14 + c15 + c16 - c17 - c18 - c21 + c23 - c24 - c25 + c27 + c28 + c3 - c4 - c8) 
        + u3*(c10 + c11 - c13 - c14 + c15 - c17 - c20 - c21 + c22 + c23 - c24 + c27 + c28 - c30 - c35 + c36)
    );
}
//////////////////////////////////////////////////
float eval_Tij_g6() {
    return 2*(
          (u0+u2)*(2*(c10 + c11 + c23 - c28 - c7) + (-c0 - c15 + c22 - c27 + c3 - c6)) 
        + u1*(-c0 - c1 + c10 + c11 + c13 + c14 - c15 - c17 - c18 - c2 + c23 - c28 + c3 + c4 + c5 - c7) 
        + u3*(-c1 + c10 + c11 + c13 + c14 - c17 + c22 + c23 + c26 - c27 - c28 - c30 + c4 - c6 - c7 - c9)
    );
}
//////////////////////////////////////////////////
float eval_Tij_g7() {
    return 2*(
        u0*(2*(c10 + c23 - c26 - c7 + c9) + (-c0 + c1 - c13 + c24 - c27 - c8)) 
        + (u1+u3)*(c10 - c11 + c14 + c15 - c17 + c23 + c24 - c26 - c27 + c28 - c3 - c30 + c4 - c7 - c8 + c9) 
        + u2*(2*(c10 + c23 + c24 - c27 - c8) + (-c21 - c26 + c35 - c36 - c7 + c9)) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_g8() {
    return 2*(
        u0*(2*(c10 + c11 + c2 - c5 - c7) + (c1 - c15 - c20 + c24 - c4 - c6)) 
        + (u1+u3)*(c10 + c11 + c13 + c14 - c15 - c17 - c18 + c2 - c20 - c22 - c23 + c24 + c27 + c28 - c5 - c7) 
        + u2*(2*(c10 + c11 - c15 - c20 + c24) + (-c16 + c2 - c21 + c25 - c5 - c7)) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_g9() {
    return 2*(
          (u0+u1)*(2*(c10 + c11 + c14 - c23 - c5) + (c13 - c20 - c22 - c3 - c4 + c8)) 
        + u2*(c10 + c11 + c14 - c15 - c16 - c20 - c23 + c24 + c25 + c27 + c28 - c3 - c34 - c35 - c5 + c8) 
        + u3*(c10 + c11 + c13 + c14 - c15 - c18 - c22 - c23 + c24 + c27 + c28 + c30 - c34 - c36 - c4 - c5)
    );
}
//////////////////////////////////////////////////
float eval_Tij_g10() {
    return 2*(
          (u0+u1)*(2*(c10 + c11 + c14 - c2 - c28) + (-c0 - c1 + c13 - c24 - c27 + c8)) 
        + u2*(-c0 + c10 + c11 + c14 - c2 + c20 + c21 + c22 + c23 - c24 - c28 - c34 - c35 - c6 - c7 + c8) 
        + u3*(-c1 + c10 + c11 + c13 + c14 - c2 + c20 + c22 + c23 + c26 - c27 - c28 - c34 - c36 - c6 - c9)
    );
}
//////////////////////////////////////////////////
float eval_Tij_g11() {
    return 2*(
          u0*(2*(c10 + c11 - c2 - c21 + c7) + (-c1 + c15 - c20 - c24 - c4 + c6)) 
        + u1*(2*(c10 + c11 + c15 - c24 - c4) + (c16 - c2 - c21 - c25 - c5 + c7)) 
        + (u2+u3)*(c10 + c11 - c13 - c14 + c15 - c2 - c21 + c22 + c23 - c24 + c27 + c28 - c34 - c35 - c4 + c7) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_g12() {
    return 2*(
          u0*(2*(c10 + c14 - c2 - c26 + c9) + (-c0 + c15 - c22 - c27 - c3 + c6)) 
        + u1*(2*(c10 + c14 + c15 - c27 - c3) + (c18 - c2 - c26 - c30 - c5 + c9)) 
        + (u2+u3)*(c10 - c11 + c14 + c15 - c2 + c20 + c23 + c24 - c26 - c27 + c28 - c3 - c34 - c36 - c8 + c9) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_r1() {
    return (
          2*((u0+u3)*(2*(c10 - c11 + c14 + c23 - c26) + (-c13 + c20 - c22 - c3 + c4 - c8)) 
        + u1*(c10 - c11 - c12 + c14 + c15 + c20 - c22 + c23 + c24 - c25 - c26 - c27 + c28 + c35 - c36 - c8) 
        )
        + u2*(4*(c10 + c23) + 3*(-c11 + c14 + c20 - c22 - c26 - c8) + (-c13 - c21 - c3 + c32 - c33 + c4)) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_r2() {
    return (
          2*((u0+u3)*(2*(c10 + c14 + c23 - c28 - c9) + (-c1 - c15 + c20 - c24 + c4 - c6)) 
        + u1*(-c0 + c10 + c11 - c12 + c14 + c20 + c21 + c23 - c24 - c25 - c28 + c3 - c6 - c7 + c8 - c9) 
        )
        + u2*(4*(c10 + c23) + (-c1 - c15 - c19 + c32 - c35 + c4) + 3*(c14 + c20 - c24 - c28 - c6 - c9)) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_r3() {
    return (
        2*(u0*(2*(c10 - c11 - c19 + c23 + c7) + (c0 - c15 - c22 + c27 - c3 - c6)) 
        + u1*(c10 - c11 - c12 - c15 - c19 - c20 + c21 - c22 + c23 + c24 - c25 + c27 - c32 + c35 + c7 + c8) 
        + u3*(2*(c10 - c15 - c22 + c23 + c27) + (-c11 - c19 - c28 - c33 + c36 + c7))
        )
        + u2*(4*(c10 + c23) + (c0 - c28 - c3 - c33 + c36 - c6) + 3*(-c11 - c15 - c19 - c22 + c27 + c7)) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_r4() {
    return (
        2*(u0*(2*(c10 - c21 + c23 + c7 - c9) + (c0 - c1 - c13 - c24 + c27 - c8)) 
        + u1*(c10 + c11 - c12 - c13 - c14 + c15 - c21 + c23 - c24 - c25 + c27 + c28 + c3 - c4 + c7 - c9) 
        + u3*(2*(c10 - c13 + c23 - c24 + c27) + (-c21 - c26 - c35 + c36 + c7 - c9))
        )
        + u2*(4*(c10 + c23) + (c0 - c1 - c26 - c35 + c36 - c8) + 3*(-c13 - c21 - c24 + c27 + c7 - c9)) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_r5() {
    return (
          2*((u0+u1)*(2*(c10 + c11 - c14 - c21 + c23) + (-c13 - c20 + c22 + c3 - c4 - c8)) 
        + u3*(c10 + c11 - c13 - c14 + c15 - c17 - c20 - c21 + c22 + c23 - c24 + c27 + c28 - c30 - c35 + c36)
        )
        + u2*(4*(c10 + c23) + 3*(c11 - c13 - c14 - c20 - c21 + c22) + (-c26 + c3 - c32 + c33 - c4 - c8)) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_r6() {
    return (
        2*((u0+u1)*(2*(c10 + c11 + c23 - c28 - c7) + (-c0 - c15 + c22 - c27 + c3 - c6)) 
        + u3*(-c1 + c10 + c11 + c13 + c14 - c17 + c22 + c23 + c26 - c27 - c28 - c30 + c4 - c6 - c7 - c9)
        )
        + u2*(4*(c10 + c23) + (-c0 - c15 - c19 + c3 + c33 - c36) + 3*(c11 + c22 - c27 - c28 - c6 - c7)) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_r7() {
    return (
          2*(u0*(2*(c10 + c23 - c26 - c7 + c9) + (-c0 + c1 - c13 + c24 - c27 - c8)) 
        + u1*(2*(c10 + c23 + c24 - c27 - c8) + (-c21 - c26 + c35 - c36 - c7 + c9)) 
        + u3*(c10 - c11 + c14 + c15 - c17 + c23 + c24 - c26 - c27 + c28 - c3 - c30 + c4 - c7 - c8 + c9)
        )
        + u2*(4*(c10 + c23) + (-c0 + c1 - c13 - c21 + c35 - c36) + 3*(c24 - c26 - c27 - c7 - c8 + c9)) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_r8() {
    return (
        2*(u0*(2*(c10 - c14 - c19 + c23 + c9) + (c1 - c15 - c20 + c24 - c4 - c6)) 
        + u1*(2*(c10 - c15 - c20 + c23 + c24) + (-c14 - c19 - c28 - c32 + c35 + c9)) 
        + u3*(c10 + c13 - c14 - c15 - c17 - c19 - c20 - c22 + c23 + c24 + c26 + c27 - c30 - c33 + c36 + c9)
        )
        + u2*(4*(c10 + c23) + (c1 - c28 - c32 + c35 - c4 - c6) + 3*(-c14 - c15 - c19 - c20 + c24 + c9)) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_r9() {
    return (
        2*(u0*(2*(c10 - c19 - c2 + c7 + c9) + (c13 - c20 - c22 - c3 - c4 + c8)) 
        + u1*(c10 - c11 - c15 - c19 - c2 - c20 + c21 + c23 + c24 + c27 - c3 - c32 - c34 + c7 + c8 + c9) 
        + u3*(c10 + c13 - c14 - c15 - c19 - c2 - c22 + c23 + c24 + c26 + c27 - c33 - c34 - c4 + c7 + c9)
        )
        + u2*(2*(c10 - c15 - c19 - c2 + c23 + c24 + c27 - c34 + c7 + c9) + (-c11 + c13 - c14 - c20 + c21 - c22 + c26 - c3 - c32 - c33 - c4 + c8)) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_r10() {
    return (
        2*(u0*(2*(c10 + c11 + c14 - c2 - c28) + (-c0 - c1 + c13 - c24 - c27 + c8)) 
        + u1*(-c0 + c10 + c11 + c14 - c2 + c20 + c21 + c22 + c23 - c24 - c28 - c34 - c35 - c6 - c7 + c8) 
        + u3*(-c1 + c10 + c11 + c13 + c14 - c2 + c20 + c22 + c23 + c26 - c27 - c28 - c34 - c36 - c6 - c9)
        )
        + u2*(2*(c10 + c11 + c14 - c2 + c20 + c22 + c23 - c28 - c34 - c6) + (-c0 - c1 + c13 + c21 - c24 + c26 - c27 - c35 - c36 - c7 + c8 - c9)) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_r11() {
    return (
        2*(u0*(2*(c10 + c11 - c2 - c21 + c7) + (-c1 + c15 - c20 - c24 - c4 + c6)) 
        + (u1+u3)*(c10 + c11 - c13 - c14 + c15 - c2 - c21 + c22 + c23 - c24 + c27 + c28 - c34 - c35 - c4 + c7) 
        )
        + u2*(2*(c10 + c11 - c13 - c2 - c21 + c22 + c23 + c27 - c34 + c7) + (-c1 - c14 + c15 + c19 - c20 - c24 + c28 - c32 - c35 - c4 + c6 - c9)) 
    );
}
//////////////////////////////////////////////////
float eval_Tij_r12() {
    return (
        2*(u0*(2*(c10 + c14 - c2 - c26 + c9) + (-c0 + c15 - c22 - c27 - c3 + c6)) 
        + (u1+u3)*(c10 - c11 + c14 + c15 - c2 + c20 + c23 + c24 - c26 - c27 + c28 - c3 - c34 - c36 - c8 + c9) 
        )
        + u2*(2*(c10 + c14 - c2 + c20 + c23 + c24 - c26 - c34 - c8 + c9) + (-c0 - c11 + c15 + c19 - c22 - c27 + c28 - c3 - c33 - c36 + c6 - c7)) 
    );
}
//////////////////////////////////////////////////

#define _1 0
#define _2 1
#define _3 2
#define _4 3
#define _5 4
#define _6 5
#define _7 6
#define _8 7
#define _9 8
#define _10 9
#define _11 10
#define _12 11

ivec3[24] map_Tj_expr = ivec3[24](
    ivec3(_1,_3,_5), ivec3(_1,_4,_6), ivec3(_2,_3,_6), ivec3(_2,_4,_5), 
    ivec3(_2,_4,_5), ivec3(_2,_3,_6), ivec3(_1,_4,_6), ivec3(_1,_3,_5),
    ivec3(_3,_5,_1), ivec3(_3,_6,_2), ivec3(_4,_5,_2), ivec3(_4,_6,_1), 
    ivec3(_4,_6,_1), ivec3(_4,_5,_2), ivec3(_3,_6,_2), ivec3(_3,_5,_1),
    ivec3(_5,_1,_3), ivec3(_5,_2,_4), ivec3(_6,_1,_4), ivec3(_6,_2,_3), 
    ivec3(_6,_2,_3), ivec3(_6,_1,_4), ivec3(_5,_2,_4), ivec3(_5,_1,_3)
);

vec3 compute_gradient(vec3 p_in, int idx_xfm)
{
    u2000 = u0*u0;
    u0200 = u1*u1;
    u0020 = u2*u2;
    u0002 = u3*u3;
    
    u1100 = u0*u1;
    u1010 = u0*u2;
    u1001 = u0*u3;
    u0110 = u1*u2;
    u0101 = u1*u3;
    u0011 = u2*u3;
    
    float[6] val_T;
    switch(type_tet)
    {
        case TYPE_BLUE:
            val_T[_1] = eval_Tj_b1();
            val_T[_2] = eval_Tj_b2();
            val_T[_3] = eval_Tj_b3();
            val_T[_4] = eval_Tj_b4();
            val_T[_5] = eval_Tj_b5();
            val_T[_6] = eval_Tj_b6();
            break;
        case TYPE_GREEN:
            val_T[_1] = eval_Tj_g1();
            val_T[_2] = eval_Tj_g2();
            val_T[_3] = eval_Tj_g3();
            val_T[_4] = eval_Tj_g4();
            val_T[_5] = eval_Tj_g5();
            val_T[_6] = eval_Tj_g6();
            break;
        case TYPE_RED:
            val_T[_1] = eval_Tj_r1();
            val_T[_2] = eval_Tj_r2();
            val_T[_3] = eval_Tj_r3();
            val_T[_4] = eval_Tj_r4();
            val_T[_5] = eval_Tj_r5();
            val_T[_6] = eval_Tj_r6();
            break;
    }
    
    
    ivec3   idx = map_Tj_expr[idx_xfm];

    vec3    T = vec3(float((((idx_xfm&0x7)>>2)<<1)-1)*val_T[idx.x],
                     float((( idx_xfm&0x1)    <<1)-1)*val_T[idx.y],
                     float((((idx_xfm&0x3)>>1)<<1)-1)*val_T[idx.z]);
    
    vec3    g = 0.5*mat3( 1, 1,-1,
                          1,-1, 1,
                         -1, 1, 1)*T*ONE_OVER_64;

    return g*scale_axes;
}
int[24] map_T13_expr = int[24](
    _10,_12,_11, _9, _9,_11,_12,_10, 
     _2, _4, _3, _1, _1, _3, _4, _2,
     _6, _8, _7, _5, _5, _7, _8, _6);
int[24] map_T24_expr = int[24](
    _9,_11,_12,_10,_10,_12,_11, _9,
    _1, _3, _4, _2, _2, _4, _3, _1, 
    _5, _7, _8, _6, _6, _8, _7, _5);
int[24] map_T15_expr = int[24](
    _6, _7, _5, _8, _8, _5, _7, _6, 
   _10,_11, _9,_12,_12, _9,_11,_10,
    _2, _3, _1, _4, _4, _1, _3, _2);
int[24] map_T26_expr = int[24](
    _5, _8, _6, _7, _7, _6, _8, _5, 
    _9,_12,_10,_11,_11,_10,_12, _9, 
    _1, _4, _2, _3, _3, _2, _4, _1);
int[24] map_T35_expr = int[24](
    _2, _1, _4, _3, _3, _4, _1, _2, 
    _6, _5, _8, _7, _7, _8, _5, _6, 
   _10, _9,_12,_11,_11,_12, _9,_10);
int[24] map_T46_expr = int[24](
    _1, _2, _3, _4, _4, _3, _2, _1, 
    _5, _6, _7, _8, _8, _7, _6, _5, 
    _9,_10,_11,_12,_12,_11,_10, _9);

float[6] compute_2nd_derivatives(int idx_xfm)
{
    float    expr[12];

    switch(type_tet)
    {
        case TYPE_BLUE:
            expr[_1]  = eval_Tij_b1();
            expr[_2]  = eval_Tij_b2();
            expr[_3]  = eval_Tij_b3();
            expr[_4]  = eval_Tij_b4();
            expr[_5]  = eval_Tij_b5();
            expr[_6]  = eval_Tij_b6();
            expr[_7]  = eval_Tij_b7();
            expr[_8]  = eval_Tij_b8();
            expr[_9]  = eval_Tij_b9();
            expr[_10] = eval_Tij_b10();
            expr[_11] = eval_Tij_b11();
            expr[_12] = eval_Tij_b12();
            break;
        case TYPE_GREEN:
            expr[_1]  = eval_Tij_g1();
            expr[_2]  = eval_Tij_g2();
            expr[_3]  = eval_Tij_g3();
            expr[_4]  = eval_Tij_g4();
            expr[_5]  = eval_Tij_g5();
            expr[_6]  = eval_Tij_g6();
            expr[_7]  = eval_Tij_g7();
            expr[_8]  = eval_Tij_g8();
            expr[_9]  = eval_Tij_g9();
            expr[_10] = eval_Tij_g10();
            expr[_11] = eval_Tij_g11();
            expr[_12] = eval_Tij_g12();
            break;
        case TYPE_RED:
            expr[_1]  = eval_Tij_r1();
            expr[_2]  = eval_Tij_r2();
            expr[_3]  = eval_Tij_r3();
            expr[_4]  = eval_Tij_r4();
            expr[_5]  = eval_Tij_r5();
            expr[_6]  = eval_Tij_r6();
            expr[_7]  = eval_Tij_r7();
            expr[_8]  = eval_Tij_r8();
            expr[_9]  = eval_Tij_r9();
            expr[_10] = eval_Tij_r10();
            expr[_11] = eval_Tij_r11();
            expr[_12] = eval_Tij_r12();
            break;
    }
    float d13 = -expr[map_T13_expr[idx_xfm]]*ONE_OVER_8;
    float d15 = -expr[map_T15_expr[idx_xfm]]*ONE_OVER_8;
    float d35 = -expr[map_T35_expr[idx_xfm]]*ONE_OVER_8;
    float d24 =  expr[map_T24_expr[idx_xfm]]*ONE_OVER_8;
    float d26 =  expr[map_T26_expr[idx_xfm]]*ONE_OVER_8;
    float d46 =  expr[map_T46_expr[idx_xfm]]*ONE_OVER_8;

    return float[6](d13, d24, d15, d26, d35, d46);
}

#define d13 dd[0]
#define d24 dd[1]
#define d15 dd[2]
#define d26 dd[3]
#define d35 dd[4]
#define d46 dd[5]
 

float[6] compute_Hessian(vec3 p_in, int idx_xfm)
{
    float[6] dd = compute_2nd_derivatives(idx_xfm);
    
    // D13 = ( Dx+Dy)( Dx+Dz) = Dxy+Dxz+Dyz+Dxx
    // D24 = (-Dx+Dy)( Dx-Dz) = Dxy+Dxz-Dyz-Dxx
    // D15 = ( Dx+Dy)( Dy+Dz) = Dxy+Dxz+Dyz+Dyy
    // D26 = (-Dx+Dy)(-Dy+Dz) = Dxy-Dxz+Dyz-Dyy
    // D35 = ( Dx+Dz)( Dy+Dz) = Dxy+Dxz+Dyz+Dzz
    // D46 = ( Dx-Dz)(-Dy+Dz) =-Dxy+Dxz+Dyz-Dzz
    //
    // [D13]   [ 1  0  0  1  1  1][Dxx]     [Dxx]        [ 3 -1 -1 -1 -1 -1][D13]
    // [D24]   [-1  0  0  1  1 -1][Dyy]     [Dyy]        [-1 -1  3 -1 -1 -1][D24]
    // [D15] = [ 0  1  0  1  1  1][Dzz] --> [Dzz] = (1/4)[-1 -1 -1 -1  3 -1][D15]
    // [D26]   [ 0 -1  0  1 -1  1][Dxy]     [Dxy]        [ 1  1  1  1 -1 -1][D26]
    // [D35]   [ 0  0  1  1  1  1][Dxz]     [Dxz]        [ 1  1 -1 -1  1  1][D35]
    // [D46]   [ 0  0 -1 -1  1  1][Dyz]     [Dyz]        [-1 -1  1  1  1  1][D46]

    float Dxx = 0.25*(3*d13 - d24 - d15 - d26 - d35 - d46)*(scale_axes.x*scale_axes.x);
    float Dyy = 0.25*( -d13 - d24+3*d15 - d26 - d35 - d46)*(scale_axes.y*scale_axes.y);
    float Dzz = 0.25*( -d13 - d24 - d15 - d26+3*d35 - d46)*(scale_axes.z*scale_axes.z);
    float Dxy = 0.25*(  d13 + d24 + d15 + d26 - d35 - d46)*(scale_axes.x*scale_axes.y);
    float Dxz = 0.25*(  d13 + d24 - d15 - d26 + d35 + d46)*(scale_axes.x*scale_axes.z);
    float Dyz = 0.25*( -d13 - d24 + d15 + d26 + d35 + d46)*(scale_axes.y*scale_axes.z);
    return float[6](Dxx,Dyy,Dzz,Dxy,Dxz,Dyz);
}


TMaterial get_material(vec3 g, float d2[6], int face)
{
    switch(render_mode)
    {
        case RENDER_MODE_CURVATURE:
        {
            float   Dxx = d2[0];
            float   Dyy = d2[1];
            float   Dzz = d2[2];
            float   Dxy = d2[3];
            float   Dxz = d2[4];
            float   Dyz = d2[5];
            
            mat3    H = mat3(Dxx, Dxy, Dxz,
                            Dxy, Dyy, Dyz,
                            Dxz, Dyz, Dzz);
            float   one_over_len_g = 1.0/length(g);
            vec3    n = -g*one_over_len_g;
            mat3    P = mat3(1.0) - mat3(n.x*n.x, n.x*n.y, n.x*n.z,
                                        n.x*n.y, n.y*n.y, n.y*n.z,
                                        n.x*n.z, n.y*n.z, n.z*n.z);
            mat3    M = -P*H*P*one_over_len_g;
            float   T = M[0][0] + M[1][1] + M[2][2];
            mat3    MMt = M*transpose(M);
            float   F = sqrt(MMt[0][0] + MMt[1][1] + MMt[2][2]);
            float   k_max = (T + sqrt(2.0*F*F - T*T))*0.5;
            float   k_min = (T - sqrt(2.0*F*F - T*T))*0.5;
            
            float   scale_k = 0.005;
            vec2    tc = vec2(scale_k*vec2(k_max,k_min)+0.5);

            TMaterial   material = 
                TMaterial(
                    vec3(.1,.1,.1),
                    texture(tex_colormap_2d, tc).xyz,
                    vec3(1,1,1),
                    vec3(0,0,0),
                    128.0*0.5
                    );
            return material;
            break;
        }
        case RENDER_MODE_BLINN_PHONG:
        {
            return uMaterial[face];
            break;
        }
    }
}


void main() {

    vec3 start = texture(tex_front, vTexCoord).xyz*dim - vec3(0.5);
    vec3 end = texture(tex_back, vTexCoord).xyz*dim - vec3(0.5);
    
    vec3	p = start;
    vec3	p_prev;
    vec3	dir = normalize(end-start);
    
    float	step = scale_step*dim.x;
    
    float	len = 0;
    float	len_full = length(end - start);
    float	voxel, voxel_prev;

    voxel = EVAL(p);

    float   orientation = 2.0*float(voxel < level)-1.0;	// equivalent to (voxel<level?1:-1)

    for(int i = 0 ; i < 1000 ; i++)
    {
        p += step*dir;
        len += step;
        if(len > len_full)
        {
            fColor = vec4(1,1,1,1);
            return;
        }
        
        voxel = EVAL(p);
        
        if(orientation*voxel > orientation*level)
        {
            // One step of Regula Falsi
            if(abs(voxel-voxel_prev) > 0.00001)
            {
                p = (p*(voxel_prev-level) - p_prev*(voxel-level))/(voxel_prev-voxel);
                preprocess(p);
                fetch_coefficients();
            }
        
            vec4 p_iso = (vec4(p,orientation)/vec4(scale_axes,1) - vec4(.5,.5,.5,0));

            // idx_xfm
            //  type_R\type_P      0   1   2    
            //         type_P<<3   0   8  16
            //      type_R       +------------
            //    (-1,-1,-1)  0  | 0   8  16  
            //    (-1,-1, 1)  1  | 1   9  17
            //    (-1, 1,-1)  2  | 2  10  18
            //    (-1, 1, 1)  3  | 3  11  19
            //    ( 1,-1,-1)  4  | 4  12  20
            //    ( 1,-1, 1)  5  | 5  13  21
            //    ( 1, 1,-1)  6  | 6  14  22
            //    ( 1, 1, 1)  7  | 7  15  23

            int idx_xfm = 4*((type_R.x+1)>>1) + 2*((type_R.y+1)>>1) + ((type_R.z+1)>>1) + (type_P<<3);
            
            vec3       g = compute_gradient(p, idx_xfm).xyz;
            
            float[6] d2 = compute_Hessian(p, idx_xfm);

            fColor = shade_Blinn_Phong(-normalize(mat3(MV)*(p_iso.w*g)), MV*vec4(p_iso.xyz,1), 
                        get_material(g, d2, int(0.5*(1.0-p_iso.w))), uLight);
            return;
        }
        voxel_prev = voxel;
        p_prev = p;
    }
    fColor = vec4(1,1,1,1);
}



