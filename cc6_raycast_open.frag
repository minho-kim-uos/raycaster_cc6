#version 330 core

#define	ONE_OVER_64		0.015625
#define	ONE_OVER_384	0.00260416666

in vec2 vTexCoord;

uniform sampler2D	tex_back;
uniform sampler2D	tex_front;
uniform sampler3D	tex_volume;
uniform vec3		scale_axes;
uniform	vec3		dim;
uniform float		level;
uniform float       scale_step;
uniform mat4        MV;

out vec4 fColor;

float[38]	c;
vec4    u;
float	u2000, u3000, u0200, u0300, u0020, u0030, u0002, u0003;
ivec3	org;

ivec3	type_R;
int		type_P;

int	type_tet;

int	idx;

#define	u0	u[0]
#define	u1	u[1]
#define	u2	u[2]
#define	u3	u[3]

#define	c0	c[0]
#define	c1	c[1]
#define	c2	c[2]
#define	c3	c[3]
#define	c4	c[4]
#define	c5	c[5]
#define	c6	c[6]
#define	c7	c[7]
#define	c8	c[8]
#define	c9	c[9]
#define	c10	c[10]
#define	c11	c[11]
#define	c12	c[12]
#define	c13	c[13]
#define	c14	c[14]
#define	c15	c[15]
#define	c16	c[16]
#define	c17	c[17]
#define	c18	c[18]
#define	c19	c[19]
#define	c20	c[20]
#define	c21	c[21]
#define	c22	c[22]
#define	c23	c[23]
#define	c24	c[24]
#define	c25	c[25]
#define	c26	c[26]
#define	c27	c[27]
#define	c28	c[28]
#define	c29	c[29]
#define	c30	c[30]
#define	c31	c[31]
#define	c32	c[32]
#define	c33	c[33]
#define	c34	c[34]
#define	c35	c[35]
#define	c36	c[36]
#define	c37	c[37]

#define	EVAL(p)	(preprocess(p), fetch_coefficients(), eval_M())

#define	GET_DATA(texcoords)	texelFetch(tex_volume, texcoords, 0).r

struct TMaterial
{
	vec3	ambient;
	vec3	diffuse;
	vec3	specular;
	vec3	emission;
	float	shininess;
};
struct TLight
{
	vec4	position;
	vec3	ambient;
	vec3	diffuse;
	vec3	specular;
};


TMaterial	uMaterial[2] =
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

TLight		uLight = TLight(
        vec4(1,1,1,0),
        vec3(.2,.2,.2),
        vec3(1,1,1),
        vec3(1,1,1)
        );

vec4 shade_Blinn_Phong(vec3 n, vec4 pos_eye, TMaterial material, TLight light)
{
	vec3	l;
	if(light.position.w == 1.0)
		l = normalize((light.position - pos_eye).xyz);		// positional light
	else
		l = normalize((light.position).xyz);	// directional light
	vec3	v = -normalize(pos_eye.xyz);
	vec3	h = normalize(l + v);
	float	l_dot_n = max(dot(l, n), 0.0);
	vec3	ambient = light.ambient * material.ambient;
	vec3	diffuse = light.diffuse * material.diffuse * l_dot_n;
	vec3	specular = vec3(0.0);

	if(l_dot_n >= 0.0)
	{
		specular = light.specular * material.specular * pow(max(dot(h, n), 0.0), material.shininess);
	}
	return vec4(ambient + diffuse + specular, 1);
}


void preprocess(vec3 p_in)
{
	org = ivec3(round(p_in));
	vec3	p_local = p_in - vec3(org);

	type_R = 2*ivec3(p_local.x>0, p_local.y>0, p_local.z>0)-1;

	vec3	p_cube = p_local.xyz*vec3(type_R);

	ivec4	bit = ivec4( p_cube[0]-p_cube[1]-p_cube[2]>0,
						-p_cube[0]+p_cube[1]-p_cube[2]>0,
						-p_cube[0]-p_cube[1]+p_cube[2]>0,
						 p_cube[0]+p_cube[1]+p_cube[2]>1);
	// bit_tet   type_tet type_P permutation
	// 0 1 2 3
	// -------------------------------------
	// 1 0 0 0       2      0        123    (edge/red)  
	// 0 1 0 0       2      1        231    (edge/red)
	// 0 0 1 0       2      2        312    (edge/red)
	// 0 0 0 1       0      0        123    (oct/blue)
	// 0 0 0 0       1      0        123    (vert/green)
	type_tet = (1+bit[3])*(bit[0]+bit[1]+bit[2]) + (1-bit[3]);	// 0 (oct), 1 (vert), 2 (edge)
	type_P = bit[1] + 2*bit[2];	// one of three even permutations

	vec4	p_ref = vec4(p_cube[type_P],
						p_cube[(type_P+1)%3],
						p_cube[(type_P+2)%3], 1);

    // Computes the barycentric coordinates w.r.t. the reference tetrahedron.
	u = float(type_tet==0)*vec4(-2*p_ref.x+p_ref.w,
								-2*p_ref.y+p_ref.w,
								-2*p_ref.z+p_ref.w,
								2*(p_ref.x+p_ref.y+p_ref.z-p_ref.w))
		+float(type_tet==1)*vec4(-(p_ref.x+p_ref.y+p_ref.z-p_ref.w),
								-p_ref.x+p_ref.y+p_ref.z,
								p_ref.x-p_ref.y+p_ref.z,
								p_ref.x+p_ref.y-p_ref.z)
		+float(type_tet==2)*vec4(-(p_ref.x+p_ref.y+p_ref.z-p_ref.w),
								2*p_ref.z,
								p_ref.x-p_ref.y-p_ref.z,
								2*p_ref.y);
}

void fetch_coefficients(void)
{
	ivec3	bit_P = ivec3(type_P==0, type_P==1, type_P==2);
	ivec3	dirx = ivec3(type_R.x*bit_P.x, type_R.y*bit_P.y, type_R.z*bit_P.z);
	ivec3	diry = ivec3(type_R.x*bit_P.z, type_R.y*bit_P.x, type_R.z*bit_P.y);
	ivec3	dirz = ivec3(type_R.x*bit_P.y, type_R.y*bit_P.z, type_R.z*bit_P.x);

	ivec3	coords = org;
#define	FETCH_C(idx_c, offset)	coords += (offset); c[idx_c] = GET_DATA(coords);
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

#undef	FETCH_C

}


float eval_M_expr_oct()
{
	return 4*u3000*(14*(c10 + c11 + c14 + c15) + 4*(c2 + c23 + c24 + c27 + c28 + c3 + c4 + c5) + (c7 + c8 + c9 + c12 + c13 + c16 + c17 + c18))
	+ 12*u2000*(u1*(17*(c10 + c11) + 11*(c14 + c15) + 7*(c23 + c24) + 5*(c27 + c28) + 3*(c2 + c3) + 2*(c7 + c8) + (c4 + c5 + c9 + c12 + c13 + c16))
			+ u2*(17*(c10 + c14) + 11*(c11 + c15) + 7*(c23 + c27) + 5*(c24 + c28) + 3*(c2 + c4) + 2*(c13 + c9) + (c3 + c5 + c7 + c8 + c17 + c18))
			+ u3*(14*(c10 + c11 + c14 + c15) + 6*(c23 + c24 + c27 + c28) + 2*(c2 + c3 + c4 + c5) + (c7 + c8 + c9 + c12 + c13 + c16 + c17 + c18)))
	+ 12*u0*(u0200*(17*(c10 + c11) + 11*(c23 + c24) + 7*(c14 + c15) + 5*(c27 + c28) + 3*(c7 + c8) + 2*(c2 + c3) + (c9 + c25 + c12 + c20 + c21 + c22))
			+ 2*u1*u2*(18*c10 + 12*(c11 + c14 + c23) + 8*(c15 + c24 + c27) + 6*c28 + 2*(c2 + c7 + c9) + (c3 + c4 + c8 + c13 + c20 + c22))
			+ u1*u3*(30*(c10 + c11) + 20*(c14 + c15 + c23 + c24) + 14*(c27 + c28) + 3*(c2 + c3 + c7 + c8) + 2*(c9 + c12) + (c4 + c5 + c13 + c16 + c20 + c21 + c22 + c25))
			+ u0020*(17*(c10 + c14) + 11*(c23 + c27) + 7*(c11 + c15) + 5*(c24 + c28) + 3*(c9 + c13) + 2*(c2 + c4) + (c7 + c17 + c20 + c22 + c26 + c30))
			+ u2*u3*(30*(c10 + c14) + 20*(c11 + c15 + c23 + c27) + 14*(c24 + c28) + 3*(c2 + c4 + c9 + c13) + 2*(c7 + c17) + (c3 + c5 + c8 + c18 + c20 + c22 + c26 + c30)))
	+ 3*u0*u0002*(50*(c10 + c11 + c14 + c15) + 34*(c23 + c24 + c27 + c28) + 4*(c2 + c3 + c4 + c5) + 3*(c7 + c8 + c9 + c12 + c13 + c16 + c17 + c18) + (c20 + c21 + c22 + c25 + c26 + c29 + c30 + c31))
	+ 4*u0300*(14*(c10 + c11 + c23 + c24) + 4*(c7 + c8 + c14 + c15 + c20 + c21 + c27 + c28) + (c2 + c3 + c9 + c12 + c22 + c25 + c34 + c35))
	+ 12*u0200*(u2*(17*(c10 + c23) + 11*(c11 + c24) + 7*(c14 + c27) + 5*(c15 + c28) + 3*(c7 + c20) + 2*(c9 + c22) + (c2 + c3 + c8 + c21 + c34 + c35))
			+ u3*(14*(c10 + c11 + c23 + c24) + 6*(c14 + c15 + c27 + c28) + 2*(c7 + c8 + c20 + c21) + (c2 + c3 + c9 + c12 + c22 + c25 + c34 + c35)))
	+ 12*u1*u0020*(17*(c10 + c23) + 11*(c14 + c27) + 7*(c11 + c24) + 5*(c15 + c28) + 3*(c9 + c22) + 2*(c7 + c20) + (c2 + c4 + c13 + c26 + c34 + c36))
	+ 12*u1*u2*u3*(30*(c10 + c23) + 20*(c11 + c14 + c24 + c27) + 14*(c15 + c28) + 3*(c7 + c9 + c20 + c22) + 2*(c2 + c34) + (c3 + c8 + c13 + c21 + c26 + c35 + c36 + c4))
	+ 3*u1*u0002*(50*(c10 + c11 + c23 + c24) + 34*(c14 + c15 + c27 + c28) + 4*(c20 + c21) + 4*(c7 + c8) + 3*(c2 + c3 + c9 + c12 + c22 + c25 + c34 + c35) + (c4 + c5 + c13 + c16 + c26 + c29 + c36 + c37))
	+ 4*u0030*(14*(c10 + c14 + c23 + c27) + 4*(c9 + c11 + c13 + c15 + c22 + c24 + c26 + c28) + (c2 + c4 + c7 + c17 + c20 + c30 + c34 + c36))
	+ 12*u0020*u3*(14*(c10 + c14 + c23 + c27) + 6*(c11 + c15 + c24 + c28) + 2*(c9 + c13 + c22 + c26) + (c2 + c4 + c7 + c17 + c20 + c30 + c34 + c36))
	+ 3*u2*u0002*(50*(c10 + c14 + c23 + c27) + 34*(c11 + c15 + c24 + c28) + 4*(c9 + c13 + c22 + c26) + 3*(c2 + c4 + c7 + c17 + c20 + c30 + c34 + c36) + (c3 + c5 + c8 + c18 + c21 + c31 + c35 + c37))
	+ 2*u0003*(21*(c10 + c11 + c14 + c15 + c23 + c24 + c27 + c28) + (c2 + c3 + c4 + c5 + c7 + c8 + c9 + c12 + c13 + c16 + c17 + c18 + c20 + c21 + c22 + c25 + c26 + c29 + c30 + c31 + c34 + c35 + c36 + c37));
}
float eval_M_expr_vert()
{
	return 
		4*
		(
		u3000*2*(12*c10 + 4*(c2 + c7 + c9 + c11 + c14 + c23) + (c0 + c1 + c8 + c13 + c15 + c20 + c22 + c24 + c27 + c3 + c4 + c6))
		+ u2000*u1*3*(24*c10 + 12*(c11+c14) + 8*(c2+c23) + 4*(c7 + c9 + c15) + 3*(c3 + c4 + c24 + c27) + 2*(c8 + c13) + (c0 + c1 + c20 + c22))
		+ u2000*u2*3*(24*c10 + 12*(c11+c23) + 8*(c7+c14) + 4*(c2 + c9 + c24) + 3*(c8 + c15 + c20 + c27) + 2*(c3 + c22) + (c0 + c4 + c6 + c13))
		+ u2000*u3*3*(24*c10 + 12*(c14+c23) + 8*(c9 + c11) + 4*(c2 + c7 + c27) + 3*(c13 + c15 + c22 + c24) + 2*(c4 + c20) + (c1 + c3 + c6 + c8))
		+ u0*u0200*6*(10*c10 + 7*(c11+c14) + 4*c15 + 3*(c2+c23) + 2*(c3 + c4 + c24 + c27) + (c5 + c7 + c8 + c9 + c13 + c28))
		+ u0*u0020*6*(10*c10 + 7*(c11+c23) + 4*c24 + 3*(c7+c14) + 2*(c8 + c15 + c20 + c27) + (c2 + c9 + c21 + c22 + c28 + c3))
		+ u0*u0002*6*(10*c10 + 7*(c14+c23) + 4*c27 + 3*(c9+c11) + 2*(c13 + c15 + c22 + c24) + (c2 + c4 + c7 + c20 + c26 + c28))
		+ u0*u1*u2*6*(22*c10 + 16*c11 + 10*(c14+c23) + 6*(c15+c24) + 4*(c2 + c7 + c27) + 3*(c3+c8) + 2*(c9+c28) + (c4 + c13 + c20 + c22))
		+ u0*u1*u3*6*(22*c10 + 16*c14 + 10*(c11+c23) + 6*(c15+c27) + 4*(c2 + c9 + c24) + 3*(c4+c13) + 2*(c7+c28) + (c3 + c8 + c20 + c22))
		+ u0*u2*u3*6*(22*c10 + 16*c23 + 10*(c11+c14) + 6*(c24+c27) + 4*(c7 + c9 + c15) + 3*(c20+c22) + 2*(c2+c28) + (c3 + c4 + c8 + c13))
		+ u0300*(14*(c10 + c11 + c14 + c15) + 4*(c2 + c23 + c24 + c27 + c28 + c3 + c4 + c5) + (c7 + c8 + c9 + c12 + c13 + c16 + c17 + c18))
		+ u0030*(14*(c10 + c11 + c23 + c24) + 4*(c7 + c8 + c14 + c15 + c20 + c21 + c27 + c28) + (c2 + c3 + c9 + c12 + c22 + c25 + c34 + c35))
		+ u0003*(14*(c10 + c14 + c23 + c27) + 4*(c9 + c11 + c13 + c15 + c22 + c24 + c26 + c28) + (c2 + c4 + c7 + c17 + c20 + c30 + c34 + c36))
		+ u0200*u2*3*(17*(c10+c11) + 11*(c14+c15) + 7*(c23+c24) + 5*(c27+c28) + 3*(c2+c3) + 2*(c7+c8) + (c4 + c5 + c9 + c12 + c13 + c16))
		+ u1*u0020*3*(17*(c10+c11) + 11*(c23+c24) + 7*(c14+c15) + 5*(c27+c28) + 3*(c7+c8) + 2*(c2+c3) + (c9 + c12 + c20 + c21 + c22 + c25))
		+ u0200*u3*3*(17*(c10+c14) + 11*(c11+c15) + 7*(c23+c27) + 5*(c24+c28) + 3*(c2+c4) + 2*(c9+c13) + (c3 + c5 + c7 + c8 + c17 + c18))
		+ u1*u0002*3*(17*(c10+c14) + 11*(c23+c27) + 7*(c11+c15) + 5*(c24+c28) + 3*(c9+c13) + 2*(c2+c4) + (c7 + c17 + c20 + c22 + c26 + c30))
		+ u0020*u3*3*(17*(c10+c23) + 11*(c11+c24) + 7*(c14+c27) + 5*(c15+c28) + 3*(c7+c20) + 2*(c9+c22) + (c2 + c3 + c8 + c21 + c34 + c35))
		+ u2*u0002*3*(17*(c10+c23) + 11*(c14+c27) + 7*(c11+c24) + 5*(c15+c28) + 3*(c9+c22) + 2*(c7+c20) + (c2 + c4 + c13 + c26 + c34 + c36))
		+ u1*u2*u3*6*(18*c10 + 12*(c11 + c14 + c23) + 8*(c15 + c24 + c27) + 6*c28 + 2*(c2 + c7 + c9) + (c3 + c4 + c8 + c13 + c20 + c22))
		);
}

float eval_M_expr_edge()
{

	return 
		4*
		(
		  u3000*2*(12*c10 + 4*(c2 + c7 + c9 + c11 + c14 + c23) + (c0 + c1 + c8 + c13 + c15 + c20 + c22 + c24 + c27 + c3 + c4 + c6))
		+ u0030*2*(12*c23 + 4*(c10 + c20 + c22 + c24 + c27 + c34) + (c7 + c9 + c11 + c14 + c19 + c21 + c26 + c28 + c32 + c33 + c35 + c36))
		+ u2000*u1*3*(24*c10 + 12*(c11 + c23) + 8*( c7 + c14) + 4*( c2 +  c9 + c24) + 3*( c8 + c15 + c20 + c27) + 2*(c3 + c22) + (c0 + c4 + c6 + c13))
		+ u2000*u3*3*(24*c10 + 12*(c14 + c23) + 8*( c9 + c11) + 4*( c2 +  c7 + c27) + 3*(c13 + c15 + c22 + c24) + 2*(c4 + c20) + (c1 + c3 + c6 + c8))
		+ u1*u0020*3*(24*c23 + 12*(c10 + c24) + 8*(c20 + c27) + 4*(c11 + c22 + c34) + 3*( c7 + c14 + c21 + c28) + 2*(c9 + c35) + (c19 + c26 + c32 + c36))
		+ u0020*u3*3*(24*c23 + 12*(c10 + c27) + 8*(c22 + c24) + 4*(c14 + c20 + c34) + 3*( c9 + c11 + c26 + c28) + 2*(c7 + c36) + (c19 + c21 + c33 + c35))
		+ u2000*u2*6*(12*c10 + 8*c23 + 4*( c7 +  c9 + c11 + c14) + 2*(c20 + c22 + c24 + c27) + (c6 + c8 + c13 + c15))
		+ u0*u0020*6*(12*c23 + 8*c10 + 4*(c20 + c22 + c24 + c27) + 2*( c7 +  c9 + c11 + c14) + (c19 + c21 + c26 + c28))
		+ u0*u0200*6*(10*c10 + 7*(c11 + c23) + 4*c24 + 3*( c7 + c14) + 2*( c8 + c15 + c20 + c27) + (c2 + c3 + c9 + c21 + c22 + c28))
		+ u0*u0002*6*(10*c10 + 7*(c14 + c23) + 4*c27 + 3*( c9 + c11) + 2*(c13 + c15 + c22 + c24) + (c2 + c4 + c7 + c20 + c26 + c28))
		+ u0200*u2*6*(10*c23 + 7*(c10 + c24) + 4*c11 + 3*(c20 + c27) + 2*( c7 + c14 + c21 + c28) + (c8 + c9 + c15 + c22 + c34 + c35))
		+ u2*u0002*6*(10*c23 + 7*(c10 + c27) + 4*c14 + 3*(c22 + c24) + 2*( c9 + c11 + c26 + c28) + (c7 + c13 + c15 + c20 + c34 + c36))
		+ u0*u1*u2*12*(10*(c10 + c23) + 4*(c11 + c24) + 3*(c7 + c14 + c20 + c27) + 2*(c9 + c22) + (c8 + c15 + c21 + c28))
		+ u0*u2*u3*12*(10*(c10 + c23) + 4*(c14 + c27) + 3*(c9 + c11 + c22 + c24) + 2*(c20 + c7) + (c13 + c15 + c26 + c28))
		+ u0*u1*u3*6*(22*c10 + 16*c23 + 10*(c11 + c14) + 6*(c24 + c27) + 4*( c7 +  c9 + c15) + 3*(c20 + c22) + 2*( c2 + c28) + (c3 + c4 + c8 + c13))
		+ u1*u2*u3*6*(22*c23 + 16*c10 + 10*(c24 + c27) + 6*(c11 + c14) + 4*(c20 + c22 + c28) + 3*( c7 +  c9) + 2*(c15 + c34) + (c21 + c26 + c35 + c36))
		+ u0300*(14*(c10 + c11 + c23 + c24) + 4*(c7 + c8 + c14 + c15 + c20 + c21 + c27 + c28) + (c2 + c3 + c9 + c12 + c22 + c25 + c34 + c35))
		+ u0003*(14*(c10 + c14 + c23 + c27) + 4*(c9 + c11 + c13 + c15 + c22 + c24 + c26 + c28) + (c4 + c7 + c17 + c2 + c20 + c30 + c34 + c36))
		+ u0200*u3*3*(17*(c10 + c23) + 11*(c11 + c24) + 7*(c14 + c27) + 5*(c15 + c28) + 3*(c7 + c20) + 2*(c9 + c22) + (c2 + c3 + c8 + c21 + c34 + c35))
		+ u1*u0002*3*(17*(c10 + c23) + 11*(c14 + c27) + 7*(c11 + c24) + 5*(c15 + c28) + 3*(c9 + c22) + 2*(c7 + c20) + (c2 + c4 + c13 + c26 + c34 + c36))
		);
}

float eval_M(void)
{
	u2000 = u0*u0;
	u3000 = u0*u2000;
	u0200 = u1*u1;
	u0300 = u1*u0200;
	u0020 = u2*u2;
	u0030 = u2*u0020;
	u0002 = u3*u3;
	u0003 = u3*u0002;
	return (float(type_tet==0)*eval_M_expr_oct()
			+float(type_tet==1)*eval_M_expr_vert()
			+float(type_tet==2)*eval_M_expr_edge())*ONE_OVER_384;
}

float	u1100, u1010, u1001, u0110, u0101, u0011;


float eval_T_expr_b2()
{
	return 
		+ u2000*(12*(c10 + c11 - c14 - c15 + c23 + c24 - c4 - c5) + 4*(-c17 - c18 - c2 + c27 + c28 - c3 + c7 + c8)) 
		+ u1100*(32*(-c14 - c15 + c23 + c24) + 8*(-c13 - c16 - c2 + c20 + c21 + c22 + c25 - c3 - c4 - c5 + c7 + c8)) 
		+ u1010*(-16*c4 + 40*(-c14 + c23) + 24*(-c15 + c24) + 8*(c10 + c11 - c13 - c17 - c18 - c2 + c20 + c22 + c27 + c28 - c5 + c7)) 
		+ u1001*(12*(-c4 - c5) + 32*(-c14 - c15 + c23 + c24) + 8*(c10 + c11 - c17 - c18 + c27 + c28) + 4*(-c13 - c16 - c2 + c20 + c21 + c22 + c25 - c3 + c7 + c8)) 
		+ u0200*(12*(-c10 - c11 - c14 - c15 + c20 + c21 + c23 + c24) + 4*(-c2 - c27 - c28 - c3 + c34 + c35 + c7 + c8)) 
		+ u0110*(16*(c20) + 40*(-c14 + c23) + 24*(-c15 + c24) + 8*(-c10 - c11 - c13 - c2 + c21 + c22 - c27 - c28 + c34 + c35 - c4 + c7)) 
		+ u0101*(12*(c20 + c21) + 32*(-c14 - c15 + c23 + c24) + 8*(-c10 - c11 - c27 - c28 + c34 + c35) + 4*(-c13 - c16 - c2 + c22 + c25 - c3 - c4 - c5 + c7 + c8)) 
		+ u0020*(24*(-c14 + c23) + 8*(-c13 - c15 + c22 + c24) + 4*(-c17 - c2 + c20 - c30 + c34 + c36 - c4 + c7)) 
		+ u0011*(40*(-c14 + c23) + 24*(-c15 + c24) + 8*(-c13 - c17 + c20 + c22 + c34 - c4) + 4*(-c18 - c2 + c21 - c30 + c35 + c36 - c5 + c7)) 
		+ u0002*(2*(-c13 - c16 + c22 + c25) + 16*(-c14 - c15 + c23 + c24) + 3*(-c17 - c18 + c20 + c21 + c34 + c35 - c4 - c5) + (-c2 - c3 - c30 - c31 + c36 + c37 + c7 + c8))
	;
}
float eval_T_expr_b4()
{
	return 
		+ u2000*(12*(-c10 + c11 - c14 + c15 - c23 - c27 + c3 + c5) + 4*(c12 - c13 + c16 + c2 - c24 - c28 + c4 - c9)) 
		+ u1100*(16*(c3) + 40*(c11 - c23) + 24*(c15 - c27) + 8*(-c10 + c12 - c14 + c16 + c2 - c20 - c22 - c24 - c28 + c5 + c8 - c9)) 
		+ u1010*(32*(c11 + c15 - c23 - c27) + 8*(-c13 + c18 + c2 - c20 - c22 - c26 + c3 - c30 + c4 + c5 + c8 - c9)) 
		+ u1001*(12*(c3 + c5) + 32*(c11 + c15 - c23 - c27) + 8*(-c10 + c12 - c14 + c16 - c24 - c28) + 4*(-c13 + c18 + c2 - c20 - c22 - c26 - c30 + c4 + c8 - c9)) 
		+ u0200*(24*(c11 - c23) + 8*(c15 - c20 - c27 + c8) + 4*(c12 + c2 - c22 + c25 + c3 - c34 - c35 - c9)) 
		+ u0110*(-16*c22 + 40*(c11 - c23) + 24*(c15 - c27) + 8*(c10 + c14 + c2 - c20 + c24 - c26 + c28 + c3 - c34 - c36 + c8 - c9)) 
		+ u0101*(40*(c11 - c23) + 24*(c15 - c27) + 8*(c12 - c20 - c22 + c3 - c34 + c8) + 4*(c16 + c2 + c25 - c26 - c35 - c36 + c5 - c9)) 
		+ u0020*(12*(c10 + c11 + c14 + c15 - c22 - c23 - c26 - c27) + 4*(-c13 + c2 + c24 + c28 - c34 - c36 + c4 - c9)) 
		+ u0011*(12*(-c22 - c26) + 32*(c11 + c15 - c23 - c27) + 8*(c10 + c14 + c24 + c28 - c34 - c36) + 4*(-c13 + c18 + c2 - c20 + c3 - c30 + c4 + c5 + c8 - c9)) 
		+ u0002*(16*(c11 + c15 - c23 - c27) + 2*(c18 - c20 - c30 + c8) + 3*(c12 + c16 - c22 - c26 + c3 - c34 - c36 + c5) +(- c13 + c2 + c25 + c29 - c35 - c37 + c4 - c9))
	;
}
float eval_T_expr_b6()
{
	return 
		+ u2000*(24*(-c11 + c14) + 8*(-c24 + c27 - c3 + c4) + 4*(-c12 + c13 - c16 + c17 + c18 - c7 - c8 + c9)) 
		+ u1100*(16*(-c8) + 40*(-c11 + c14) + 24*(-c24 + c27) + 8*(c10 - c12 + c13 + c15 - c21 + c23 - c25 + c28 - c3 + c4 - c7 + c9)) 
		+ u1010*(16*(c13) + 40*(-c11 + c14) + 24*(-c24 + c27) + 8*(-c10 - c15 + c17 - c23 + c26 - c28 - c3 + c30 + c4 - c7 - c8 + c9)) 
		+ u1001*(40*(-c11 + c14) + 24*(-c24 + c27) + 8*(-c12 + c13 + c17 - c3 + c4 - c8) + 4*(-c16 + c18 - c21 - c25 + c26 + c30 - c7 + c9)) 
		+ u0200*(12*(c10 - c11 + c14 - c21 + c23 - c24 + c27 - c8) + 4*(-c12 + c15 - c20 + c22 - c25 + c28 - c7 + c9)) 
		+ u0110*(32*(-c11 + c14 - c24 + c27) + 8*(c13 - c20 - c21 + c22 + c26 - c3 - c35 + c36 + c4 - c7 - c8 + c9)) 
		+ u0101*(12*(-c21 - c8) + 32*(-c11 + c14 - c24 + c27) + 8*(c10 - c12 + c15 + c23 - c25 + c28) + 4*(c13 - c20 + c22 + c26 - c3 - c35 + c36 + c4 - c7 + c9)) 
		+ u0020*(12*(-c10 - c11 + c13 + c14 - c23 - c24 + c26 + c27) + 4*(-c15 + c17 - c20 + c22 - c28 + c30 - c7 + c9)) 
		+ u0011*(12*(c13 + c26) + 32*(-c11 + c14 - c24 + c27) + 8*(-c10 - c15 + c17 - c23 - c28 + c30) + 4*(-c20 - c21 + c22 - c3 - c35 + c36 + c4 - c7 - c8 + c9)) 
		+ u0002*(16*(-c11 + c14 - c24 + c27) + 2*(-c3 - c35 + c36 + c4) + 3*(-c12 + c13 + c17 - c21 - c25 + c26 + c30 - c8) + (-c16 + c18 - c20 + c22 - c29 + c31 - c7 + c9))
	;
}
float eval_T_expr_b1()
{
	return 
		+ u2000*(12*(-c10 - c11 + c14 + c15 - c2 + c27 + c28 - c3) + 4*(c17 + c18 + c23 + c24 - c4 - c5 - c7 - c8)) 
		+ u1100*(32*(-c10 - c11 + c27 + c28) + 16*(c14 + c15 - c2 + c23 + c24 - c3 - c7 - c8)) 
		+ u1010*(16*(-c2) + 40*(-c10 + c27) + 24*(-c11 + c28) + 8*(c14 + c15 + c17 + c23 + c24 + c26 - c3 + c30 - c4 - c7 - c8 - c9)) 
		+ u1001*(12*(-c2 - c3) + 32*(-c10 - c11 + c27 + c28) + 8*(c14 + c15 + c23 + c24 - c7 - c8) + 4*(-c12 + c17 + c18 + c26 + c29 + c30 + c31 - c4 - c5 - c9)) 
		+ u0200*(12*(-c10 - c11 + c23 + c24 + c27 + c28 - c7 - c8) + 4*(c14 + c15 - c2 - c20 - c21 - c3 + c34 + c35)) 
		+ u0110*(16*(-c7) + 40*(-c10 + c27) + 24*(-c11 + c28) + 8*(c14 + c15 - c2 - c20 + c23 + c24 + c26 - c3 + c34 + c36 - c8 - c9)) 
		+ u0101*(12*(-c7 - c8) + 32*(-c10 - c11 + c27 + c28) + 8*(c14 + c15 - c2 + c23 + c24 - c3) + 4*(-c12 - c20 - c21 + c26 + c29 + c34 + c35 + c36 + c37 - c9)) 
		+ u0020*(24*(-c10 + c27) + 8*(-c11 + c26 + c28 - c9) + 4*(c17 - c2 - c20 + c30 + c34 + c36 - c4 - c7)) 
		+ u0011*(40*(-c10 + c27) + 24*(-c11 + c28) + 8*(-c2 + c26 + c30 + c36 - c7 - c9) + 4*(c17 - c20 - c3 + c31 + c34 + c37 - c4 - c8)) 
		+ u0002*(16*(-c10 - c11 + c27 + c28) + 3*(-c2 - c3 + c30 + c31 + c36 + c37 - c7 - c8) + 2*(-c12 + c26 + c29 - c9) + (c17 + c18 - c20 - c21 + c34 + c35 - c4 - c5))
	;
}
float eval_T_expr_b3()
{
	return 
		u2000*(12*(-c10 + c11 - c14 + c15 - c2 + c24 + c28 - c4) + 4*(c12 - c13 + c16 + c23 + c27 - c3 - c5 - c9)) 
		+ u1100*(16*(-c2) + 40*(-c10 + c24) + 24*(-c14 + c28) + 8*(c11 + c12 - c13 + c15 + c21 + c23 + c25 + c27 - c3 - c4 - c7 - c9)) 
		+ u1010*(32*(-c10 - c14 + c24 + c28) + 16*(c11 - c13 + c15 - c2 + c23 + c27 - c4 - c9)) 
		+ u1001*(12*(-c2-c4) + 32*(-c10 - c14 + c24 + c28) + 8*(c11 - c13 + c15 + c23 + c27 - c9) + 4*(c12 + c16 - c17 + c21 + c25 + c29 - c3 + c31 - c5 - c7)) 
		+ u0200*(24*(-c10 + c24) + 8*(-c14 + c21 + c28 - c7) + 4*(c12 - c2 - c22 + c25 - c3 + c34 + c35 - c9)) 
		+ u0110*(16*(-c9) + 40*(-c10 + c24) + 24*(-c14 + c28) + 8*(c11 - c13 + c15 - c2 + c21 - c22 + c23 + c27 + c34 + c35 - c4 - c7)) 
		+ u0101*(40*(-c10 + c24) + 24*(-c14 + c28) + 8*(-c2 + c21 + c25 + c35 - c7 - c9) + 4*(c12 - c13 - c22 + c29 - c3 + c34 + c37 - c4)) 
		+ u0020*(12*(-c10 - c13 - c14 + c23 + c24 + c27 + c28 - c9) + 4*(c11 + c15 - c2 - c22 - c26 + c34 + c36 - c4)) 
		+ u0011*(12*(-c13 - c9) + 32*(-c10 - c14 + c24 + c28) + 8*(c11 + c15 - c2 + c23 + c27 - c4) + 4*(-c17 + c21 - c22 - c26 + c31 + c34 + c35 + c36 + c37 - c7)) 
		+ u0002*(16*(-c10 - c14 + c24 + c28) + 2*(-c17 + c21 + c31 - c7) + (c12 + c16 - c22 - c26 - c3 + c34 + c36 - c5) + 3*(-c13 - c2 + c25 + c29 + c35 + c37 - c4 - c9))
	;
}
float eval_T_expr_b5()
{
	return 
		u2000*(24*(-c10 + c15) + 8*(-c2 - c23 + c28 + c5) + 4*(c12 - c13 + c16 + c17 + c18 - c7 - c8 - c9)) 
		+ u1100*(16*(-c7) + 40*(-c10 + c15) + 24*(-c23 + c28) + 8*(c11 + c12 + c14 + c16 - c2 - c20 - c22 + c24 + c27 + c5 - c8 - c9)) 
		+ u1010*(16*(-c9) + 40*(-c10 + c15) + 24*(-c23 + c28) + 8*(c11 - c13 + c14 + c17 + c18 - c2 - c20 - c22 + c24 + c27 + c5 - c7)) 
		+ u1001*(40*(-c10 + c15) + 24*(-c23 + c28) + 8*(c16 + c18 - c2 + c5 - c7 - c9) + 4*(c12 - c13 + c17 - c20 - c22 + c29 + c31 - c8)) 
		+ u0200*(12*(-c10 + c11 + c15 - c20 - c23 + c24 + c28 - c7) + 4*(c12 + c14 - c21 - c22 + c25 + c27 - c8 - c9)) 
		+ u0110*(32*(-c10 + c15 - c23 + c28) + 16*(c11 + c14 - c20 - c22 + c24 + c27 - c7 - c9)) 
		+ u0101*(12*(-c20 - c7) + 32*(-c10 + c15 - c23 + c28) + 8*(c11 + c14 - c22 + c24 + c27 - c9) + 4*(c12 + c16 - c2 - c21 + c25 + c29 - c34 + c37 + c5 - c8)) 
		+ u0020*(12*(-c10 + c14 + c15 - c22 - c23 + c27 + c28 - c9) + 4*(c11 - c13 + c17 - c20 + c24 - c26 + c30 - c7)) 
		+ u0011*(12*(-c22 - c9) + 32*(-c10 + c15 - c23 + c28) + 8*(c11 + c14 - c20 + c24 + c27 - c7) + 4*(-c13 + c17 + c18 - c2 - c26 + c30 + c31 - c34 + c37 + c5)) 
		+ u0002*(16*(-c10 + c15 - c23 + c28) + 2*(-c2 - c34 + c37 + c5) + ( c12 - c13 + c17 - c21 + c25 - c26 + c30 - c8) + 3*(c16 + c18 - c20 - c22 + c29 + c31 - c7 - c9))
	;
}
float eval_T_expr_g2()
{
	return 
    4*(
		u2000*(2*(c20 - c4) + 4*(-c14 - c2 + c23 + c7) + (-c1 - c13 - c15 + c22 + c24 - c3 + c6 + c8)) 
		+ u1100*(6*(-c4) + 8*(-c14 + c23) + 2*(-c13 + c20 + c22 - c3 + c8) + 4*(c10 + c11 - c15 - c2 + c24 - c5 + c7)) 
		+ u1010*(6*(c20) + 8*(-c14 + c23) + 2*(-c13 + c22 - c3 - c4 + c8) + 4*(-c10 - c11 - c15 - c2 + c21 + c24 + c7)) 
		+ u1001*(12*(-c14 + c23) + 4*(-c13 - c15 - c2 + c20 + c22 + c24 - c4 + c7)) 
		+ u0200*(3*(c10 + c11 - c14 - c15 + c23 + c24 - c4 - c5) + (-c17 - c18 - c2 + c27 + c28 - c3 + c7 + c8)) 
		+ u0110*(8*(-c14 - c15 + c23 + c24) + 2*(-c13 - c16 - c2 + c20 + c21 + c22 + c25 - c3 - c4 - c5 + c7 + c8)) 
		+ u0101*(4*(-c4) + 10*(-c14 + c23) + 6*(-c15 + c24) + 2*(c10 + c11 - c13 - c17 - c18 - c2 + c20 + c22 + c27 + c28 - c5 + c7)) 
		+ u0020*(3*(-c10 - c11 - c14 - c15 + c20 + c21 + c23 + c24) + (-c2 - c27 - c28 - c3 + c34 + c35 + c7 + c8)) 
		+ u0011*(4*(c20) + 10*(-c14 + c23) + 6*(-c15 + c24) + 2*(-c10 - c11 - c13 - c2 + c21 + c22 - c27 - c28 + c34 + c35 - c4 + c7)) 
		+ u0002*(6*(-c14 + c23) + 2*(-c13 - c15 + c22 + c24) + (-c17 - c2 + c20 - c30 + c34 + c36 - c4 + c7))
	);
}
float eval_T_expr_g4()
{
	return 
    4*(
		u2000*(2*(c3-c22) + 4*(c11 + c2 - c23 - c9) + (c0 - c13 + c15 - c20 - c27 + c4 - c6 + c8)) 
		+ u1100*(6*(c3) + 8*(c11 - c23) + 2*(-c13 - c20 - c22 + c4 + c8) + 4*(-c10 - c14 + c15 + c2 - c27 + c5 - c9)) 
		+ u1010*(12*(c11 - c23) + 4*(c15 + c2 - c20 - c22 - c27 + c3 + c8 - c9)) 
		+ u1001*(6*(-c22) + 8*(c11 - c23) + 2*(-c13 - c20 + c3 + c4 + c8) + 4*(c10 + c14 + c15 + c2 - c26 - c27 - c9)) 
		+ u0200*(3*(-c10 + c11 - c14 + c15 - c23 - c27 + c3 + c5) + (c12 - c13 + c16 + c2 - c24 - c28 + c4 - c9)) 
		+ u0110*(4*(c3) + 10*(c11 - c23) + 6*(c15 - c27) + 2*(-c10 + c12 - c14 + c16 + c2 - c20 - c22 - c24 - c28 + c5 + c8 - c9)) 
		+ u0101*(8*(c11 + c15 - c23 - c27) + 2*(-c13 + c18 + c2 - c20 - c22 - c26 + c3 - c30 + c4 + c5 + c8 - c9)) 
		+ u0020*(6*(c11 - c23) + 2*(c15 - c20 - c27 + c8) + (c12 + c2 - c22 + c25 + c3 - c34 - c35 - c9)) 
		+ u0011*(4*(-c22) + 10*(c11 - c23) + 6*(c15 - c27) + 2*(c10 + c14 + c2 - c20 + c24 - c26 + c28 + c3 - c34 - c36 + c8 - c9)) 
		+ u0002*(3*(c10 + c11 + c14 + c15 - c22 - c23 - c26 - c27) + (-c13 + c2 + c24 + c28 - c34 - c36 + c4 - c9))
	);
}
float eval_T_expr_g6()
{
	return 
    4*(
		u2000*(2*(c13 - c8) + 4*(-c11 + c14 - c7 + c9) + (-c0 + c1 - c20 + c22 - c24 + c27 - c3 + c4)) 
		+ u1100*(12*(-c11 + c14) + 4*(c13 - c24 + c27 - c3 + c4 - c7 - c8 + c9)) 
		+ u1010*(6*(-c8) + 8*(-c11 + c14) + 2*(c13 - c20 + c22 - c3 + c4) + 4*(c10 - c21 + c23 - c24 + c27 - c7 + c9)) 
		+ u1001*(6*(c13) + 8*(-c11 + c14) + 2*(-c20 + c22 - c3 + c4 - c8) + 4*(-c10 - c23 - c24 + c26 + c27 - c7 + c9)) 
		+ u0200*(6*(-c11 + c14) + 2*(-c24 + c27 - c3 + c4) + (-c12 + c13 - c16 + c17 + c18 - c7 - c8 + c9)) 
		+ u0110*(4*(-c8) + 10*(-c11 + c14) + 6*(-c24 + c27) + 2*(c10 - c12 + c13 + c15 - c21 + c23 - c25 + c28 - c3 + c4 - c7 + c9)) 
		+ u0101*(4*(c13) + 10*(-c11 + c14) + 6*(-c24 + c27) + 2*(-c10 - c15 + c17 - c23 + c26 - c28 - c3 + c30 + c4 - c7 - c8 + c9)) 
		+ u0020*(3*(c10 - c11 + c14 - c21 + c23 - c24 + c27 - c8) + (-c12 + c15 - c20 + c22 - c25 + c28 - c7 + c9)) 
		+ u0011*(8*(-c11 + c14 - c24 + c27) + 2*(c13 - c20 - c21 + c22 + c26 - c3 - c35 + c36 + c4 - c7 - c8 + c9)) 
		+ u0002*(3*(-c10 - c11 + c13 + c14 - c23 - c24 + c26 + c27) + (-c15 + c17 - c20 + c22 - c28 + c30 - c7 + c9))
	);
}
float eval_T_expr_g1()
{
	return 
    4*(
		u2000*(2*(-c0 + c27) + 4*(c14 - c2 + c23 - c7) + (-c1 + c13 + c15 + c22 + c24 - c3 - c6 - c8)) 
		+ u1100*(6*(c27) + 8*(c14 - c2) + 2*(-c0 - c1 + c13 + c24 - c8) + 4*(-c10 - c11 + c15 + c23 + c28 - c3 - c7)) 
		+ u1010*(6*(c27) + 8*(c23 - c7) + 2*(-c0 + c15 + c22 - c3 - c6) + 4*(-c10 - c11 + c14 - c2 + c24 + c28 - c8)) 
		+ u1001*(8*(-c10 + c27) + 2*(-c1 + c13 + c15 + c22 + c24 - c3 - c6 - c8) + 4*(-c11 + c14 - c2 + c23 + c26 + c28 - c7 - c9)) 
		+ u0200*(3*(-c10 - c11 + c14 + c15 - c2 + c27 + c28 - c3) + (c17 + c18 + c23 + c24 - c4 - c5 - c7 - c8)) 
		+ u0110*(8*(-c10 - c11 + c27 + c28) + 4*(c14 + c15 - c2 + c23 + c24 - c3 - c7 - c8)) 
		+ u0101*(4*(-c2) + 10*(-c10 + c27) + 6*(-c11 + c28) + 2*(c14 + c15 + c17 + c23 + c24 + c26 - c3 + c30 - c4 - c7 - c8 - c9)) 
		+ u0020*(3*(-c10 - c11 + c23 + c24 + c27 + c28 - c7 - c8) + (c14 + c15 - c2 - c20 - c21 - c3 + c34 + c35)) 
		+ u0011*(4*(-c7) + 10*(-c10 + c27) + 6*(-c11 + c28) + 2*(c14 + c15 - c2 - c20 + c23 + c24 + c26 - c3 + c34 + c36 - c8 - c9)) 
		+ u0002*(6*(-c10 + c27) + 2*(-c11 + c26 + c28 - c9) + (c17 - c2 - c20 + c30 + c34 + c36 - c4 - c7))
	);
}
float eval_T_expr_g3()
{
	return 
    4*(
		u2000*(2*(-c1 + c24) + 4*(c11 - c2 + c23 - c9) + (-c0 - c13 + c15 + c20 + c27 - c4 - c6 + c8)) 
		+ u1100*(6*(c24) + 8*(c11 - c2) + 2*(-c0 - c1 - c13 + c27 + c8) + 4*(-c10 - c14 + c15 + c23 + c28 - c4 - c9)) 
		+ u1010*(8*(-c10 + c24) + 2*(-c0 - c13 + c15 + c20 + c27 - c4 - c6 + c8) + 4*(c11 - c14 - c2 + c21 + c23 + c28 - c7 - c9)) 
		+ u1001*(6*(c24) + 8*(c23 - c9) + 2*(-c1 + c15 + c20 - c4 - c6) + 4*(-c10 + c11 - c13 - c14 - c2 + c27 + c28)) 
		+ u0200*(3*(-c10 + c11 - c14 + c15 - c2 + c24 + c28 - c4) + (c12 - c13 + c16 + c23 + c27 - c3 - c5 - c9)) 
		+ u0110*(4*(-c2) + 10*(-c10 + c24) + 6*(-c14 + c28) + 2*(c11 + c12 - c13 + c15 + c21 + c23 + c25 + c27 - c3 - c4 - c7 - c9)) 
		+ u0101*(8*(-c10 - c14 + c24 + c28) + 4*(c11 - c13 + c15 - c2 + c23 + c27 - c4 - c9)) 
		+ u0020*(6*(-c10 + c24) + 2*(-c14 + c21 + c28 - c7) + (c12 - c2 - c22 + c25 - c3 + c34 + c35 - c9)) 
		+ u0011*(4*(-c9) + 10*(-c10 + c24) + 6*(-c14 + c28) + 2*(c11 - c13 + c15 - c2 + c21 - c22 + c23 + c27 + c34 + c35 - c4 - c7)) 
		+ u0002*(3*(-c10 - c13 - c14 + c23 + c24 + c27 + c28 - c9) + (c11 + c15 - c2 - c22 - c26 + c34 + c36 - c4))
	);
}
float eval_T_expr_g5()
{
	return 
    4*(
		u2000*(2*(c15 - c6) + 4*(c11 + c14 - c7 - c9) + (-c0 - c1 - c20 - c22 + c24 + c27 + c3 + c4)) 
		+ u1100*(8*(-c10 + c15) + 2*(-c0 - c1 - c20 - c22 + c24 + c27 + c3 + c4) + 4*(c11 + c14 - c2 - c23 + c28 + c5 - c7 - c9)) 
		+ u1010*(6*(c15) + 8*(c11 - c7) + 2*(-c0 - c22 + c27 + c3 - c6) + 4*(-c10 + c14 - c20 - c23 + c24 + c28 - c9)) 
		+ u1001*(6*(c15) + 8*(c14 - c9) + 2*(-c1 - c20 + c24 + c4 - c6) + 4*(-c10 + c11 - c22 - c23 + c27 + c28 - c7)) 
		+ u0200*(6*(-c10 + c15) + 2*(-c2 - c23 + c28 + c5) + (c12 - c13 + c16 + c17 + c18 - c7 - c8 - c9)) 
		+ u0110*(4*(-c7) + 10*(-c10 + c15) + 6*(-c23 + c28) + 2*(c11 + c12 + c14 + c16 - c2 - c20 - c22 + c24 + c27 + c5 - c8 - c9)) 
		+ u0101*(4*(-c9) + 10*(-c10 + c15) + 6*(-c23 + c28) + 2*(c11 - c13 + c14 + c17 + c18 - c2 - c20 - c22 + c24 + c27 + c5 - c7)) 
		+ u0020*(3*(-c10 + c11 + c15 - c20 - c23 + c24 + c28 - c7) + (c12 + c14 - c21 - c22 + c25 + c27 - c8 - c9)) 
		+ u0011*(8*(-c10 + c15 - c23 + c28) + 4*(c11 + c14 - c20 - c22 + c24 + c27 - c7 - c9)) 
		+ u0002*(3*(-c10 + c14 + c15 - c22 - c23 + c27 + c28 - c9) + (c11 - c13 + c17 - c20 + c24 - c26 + c30 - c7))
	);
}
float eval_T_expr_r2()
{
	return 
    4*(
		u2000*(2*(c20 - c4) + 4*(-c14 - c2 + c23 + c7) + (-c1 - c13 - c15 + c22 + c24 - c3 + c6 + c8)) 
		+ u1100*(6*(c20) + 8*(-c14 + c23) + 2*(-c13 + c22 - c3 - c4 + c8) + 4*(-c10 - c11 - c15 - c2 + c21 + c24 + c7)) 
		+ u1010*(8*(-c10 - c14 + c20 + c23) + 4*(-c11 - c13 - c15 + c19 + c21 + c22 + c24 - c9)) 
		+ u1001*(12*(-c14 + c23) + 4*(-c13 - c15 - c2 + c20 + c22 + c24 - c4 + c7)) 
		+ u0200*(3*(-c10 - c11 - c14 - c15 + c20 + c21 + c23 + c24) + (-c2 - c27 - c28 - c3 + c34 + c35 + c7 + c8)) 
		+ u0110*(6*(-c14) + 8*(-c10 + c20) + 2*(c19 - c28 + c32 + c35 - c9) + 4*(-c11 - c15 + c21 + c23 + c24 - c27 + c34)) 
		+ u0101*(4*(c20) + 10*(-c14 + c23) + 6*(-c15 + c24) + 2*(-c10 - c11 - c13 - c2 + c21 + c22 - c27 - c28 + c34 + c35 - c4 + c7)) 
		+ u0020*(2*(-c14 + c32) + 4*(-c10 + c20 - c27 + c34) + (-c11 + c19 + c21 - c26 - c28 + c33 + c35 - c9)) 
		+ u0011*(8*(-c14 + c23) + 4*(-c10 - c13 - c15 + c20 + c22 + c24 - c27 + c34) + 2*(-c11 + c19 + c21 - c26 - c28 + c33 + c35 - c9)) 
		+ u0002*(6*(-c14 + c23) + 2*(-c13 - c15 + c22 + c24) + (-c17 - c2 + c20 - c30 + c34 + c36 - c4 + c7))
	);
}
float eval_T_expr_r4()
{
	return 
    4*(
		u2000*(2*(-c22 + c3) + 4*(c11 + c2 - c23 - c9) + (c0 - c13 + c15 - c20 - c27 + c4 - c6 + c8)) 
		+ u1100*(12*(c11 - c23) + 4*(c15 + c2 - c20 - c22 - c27 + c3 + c8 - c9)) 
		+ u1010*(8*(c10 + c11 - c22 - c23) + 4*(c14 + c15 - c19 - c20 - c26 - c27 + c7 + c8)) 
		+ u1001*(6*(-c22) + 8*(c11 - c23) + 2*(-c13 - c20 + c3 + c4 + c8) + 4*(c10 + c14 + c15 + c2 - c26 - c27 - c9)) 
		+ u0200*(6*(c11 - c23) + 2*(c15 - c20 - c27 + c8) + (c12 + c2 - c22 + c25 + c3 - c34 - c35 - c9)) 
		+ u0110*(8*(c11 - c23) + 4*(c10 + c15 - c20 - c22 + c24 - c27 - c34 + c8) + 2*(c14 - c19 + c21 - c26 + c28 - c32 - c36 + c7)) 
		+ u0101*(4*(-c22) + 10*(c11 - c23) + 6*(c15 - c27) + 2*(c10 + c14 + c2 - c20 + c24 - c26 + c28 + c3 - c34 - c36 + c8 - c9)) 
		+ u0020*(2*(c11 - c33) + 4*(c10 - c22 + c24 - c34) + (c14 - c19 + c21 - c26 + c28 - c32 - c36 + c7)) 
		+ u0011*(6*(c11) + 8*(c10 - c22) + 2*(-c19 + c28 - c33 - c36 + c7) + 4*(c14 + c15 - c23 + c24 - c26 - c27 - c34)) 
		+ u0002*(3*(c10 + c11 + c14 + c15 - c22 - c23 - c26 - c27) + (-c13 + c2 + c24 + c28 - c34 - c36 + c4 - c9))
	);
}
float eval_T_expr_r6()
{
	return 
    4*(
		u2000*(2*(c13 - c8) + 4*(-c11 + c14 - c7 + c9) + (-c0 + c1 - c20 + c22 - c24 + c27 - c3 + c4)) 
		+ u1100*(6*(-c8) + 8*(-c11 + c14) + 2*(c13 - c20 + c22 - c3 + c4) + 4*(c10 - c21 + c23 - c24 + c27 - c7 + c9)) 
		+ u1010*(4*(-c11 + c13 + c14 - c20 - c21 + c22 - c24 + c26 + c27 - c7 - c8 + c9) )
		+ u1001*(6*(c13) + 8*(-c11 + c14) + 2*(-c20 + c22 - c3 + c4 - c8) + 4*(-c10 - c23 - c24 + c26 + c27 - c7 + c9)) 
		+ u0200*(3*(c10 - c11 + c14 - c21 + c23 - c24 + c27 - c8) + (-c12 + c15 - c20 + c22 - c25 + c28 - c7 + c9)) 
		+ u0110*(6*(-c21) + 8*(-c24 + c27) + 2*(c26 - c35 + c36 - c7 + c9) + 4*(c10 - c11 + c14 - c20 + c22 + c23 - c8)) 
		+ u0101*(8*(-c11 + c14 - c24 + c27) + 2*(c13 - c20 - c21 + c22 + c26 - c3 - c35 + c36 + c4 - c7 - c8 + c9)) 
		+ u0020*(2*(-c21 + c26) + 4*(-c20 + c22 - c24 + c27) + (-c11 + c14 - c32 + c33 - c35 + c36 - c7 + c9)) 
		+ u0011*(6*(c26) + 8*(-c24 + c27) + 2*(-c21 - c35 + c36 - c7 + c9) + 4*(-c10 - c11 + c13 + c14 - c20 + c22 - c23)) 
		+ u0002*(3*(-c10 - c11 + c13 + c14 - c23 - c24 + c26 + c27) + (-c15 + c17 - c20 + c22 - c28 + c30 - c7 + c9))
	);
}

float eval_T_expr_r1()
{
	return 
    4*(
		u2000*(2*(-c0 + c27) + 4*(c14 - c2 + c23 - c7) + (-c1 + c13 + c15 + c22 + c24 - c3 - c6 - c8)) 
		+ u1100*(6*(c27) + 8*(c23 - c7) + 2*(-c0 + c15 + c22 - c3 - c6) + 4*(-c10 - c11 + c14 - c2 + c24 + c28 - c8)) 
		+ u1010*(8*(-c10 + c23 + c27 - c7) + 4*(-c11 + c22 + c24 + c26 + c28 - c6 - c8 - c9)) 
		+ u1001*(8*(-c10 + c27) + 2*(-c1 + c13 + c15 + c22 + c24 - c3 - c6 - c8) + 4*(-c11 + c14 - c2 + c23 + c26 + c28 - c7 - c9)) 
		+ u0200*(3*(-c10 - c11 + c23 + c24 + c27 + c28 - c7 - c8) + (c14 + c15 - c2 - c20 - c21 - c3 + c34 + c35)) 
		+ u0110*(6*(-c7) + 8*(-c10 + c27) + 2*(-c21 + c26 + c35 + c36 - c9) + 4*(-c11 - c20 + c23 + c24 + c28 + c34 - c8)) 
		+ u0101*(4*(-c7) + 10*(-c10 + c27) + 6*(-c11 + c28) + 2*(c14 + c15 - c2 - c20 + c23 + c24 + c26 - c3 + c34 + c36 - c8 - c9)) 
		+ u0020*(2*(c36 - c7) + 4*(-c10 - c20 + c27 + c34) + (-c11 - c19 - c21 + c26 + c28 + c33 + c35 - c9)) 
		+ u0011*(12*(-c10 + c27) + 4*(-c11 - c20 + c26 + c28 + c34 + c36 - c7 - c9)) 
		+ u0002*(6*(-c10 + c27) + 2*(-c11 + c26 + c28 - c9) + (c17 - c2 - c20 + c30 + c34 + c36 - c4 - c7))
	);
}

float eval_T_expr_r3()
{
	return 
    4*(
		u2000*(2*(-c1 + c24) + 4*(c11 - c2 + c23 - c9) + (-c0 - c13 + c15 + c20 + c27 - c4 - c6 + c8)) 
		+ u1100*(8*(-c10 + c24) + 2*(-c0 - c13 + c15 + c20 + c27 - c4 - c6 + c8) + 4*(c11 - c14 - c2 + c21 + c23 + c28 - c7 - c9)) 
		+ u1010*(8*(-c10 + c23 + c24 - c9) + 4*(-c13 - c14 + c20 + c21 + c27 + c28 - c6 - c7)) 
		+ u1001*(6*(c24) + 8*(c23 - c9) + 2*(-c1 + c15 + c20 - c4 - c6) + 4*(-c10 + c11 - c13 - c14 - c2 + c27 + c28)) 
		+ u0200*(6*(-c10 + c24) + 2*(-c14 + c21 + c28 - c7) + (c12 - c2 - c22 + c25 - c3 + c34 + c35 - c9)) 
		+ u0110*(12*(-c10 + c24) + 4*(-c14 + c21 - c22 + c28 + c34 + c35 - c7 - c9)) 
		+ u0101*(4*(-c9) + 10*(-c10 + c24) + 6*(-c14 + c28) + 2*(c11 - c13 + c15 - c2 + c21 - c22 + c23 + c27 + c34 + c35 - c4 - c7)) 
		+ u0020*(2*(c35 - c9) + 4*(-c10 - c22 + c24 + c34) + (-c14 - c19 + c21 - c26 + c28 + c32 + c36 - c7)) 
		+ u0011*(6*(-c9) + 8*(-c10 + c24) + 2*(c21 - c26 + c35 + c36 - c7) + 4*(-c13 - c14 - c22 + c23 + c27 + c28 + c34)) 
		+ u0002*(3*(-c10 - c13 - c14 + c23 + c24 + c27 + c28 - c9) + (c11 + c15 - c2 - c22 - c26 + c34 + c36 - c4))
	);
}
float eval_T_expr_r5()
{
	return 
    4*(
		u2000*(2*(c15 - c6) + 4*(c11 + c14 - c7 - c9) + (-c0 - c1 - c20 - c22 + c24 + c27 + c3 + c4)) 
		+ u1100*(6*(c15) + 8*(c11 - c7) + 2*(-c0 - c22 + c27 + c3 - c6) + 4*(-c10 + c14 - c20 - c23 + c24 + c28 - c9)) 
		+ u1010*(4*(c11 + c14 + c15 - c19 - c20 - c22 + c24 + c27 + c28 - c6 - c7 - c9))
		+ u1001*(6*(c15) + 8*(c14 - c9) + 2*(-c1 - c20 + c24 + c4 - c6) + 4*(-c10 + c11 - c22 - c23 + c27 + c28 - c7)) 
		+ u0200*(3*(-c10 + c11 + c15 - c20 - c23 + c24 + c28 - c7) + (c12 + c14 - c21 - c22 + c25 + c27 - c8 - c9)) 
		+ u0110*(6*(c28) + 8*(-c20 + c24) + 2*(c14 - c19 - c32 + c35 - c9) + 4*(-c10 + c11 + c15 - c22 - c23 + c27 - c7)) 
		+ u0101*(8*(-c10 + c15 - c23 + c28) + 4*(c11 + c14 - c20 - c22 + c24 + c27 - c7 - c9)) 
		+ u0020*(2*(-c19 + c28) + 4*(-c20 - c22 + c24 + c27) + (c11 + c14 - c32 - c33 + c35 + c36 - c7 - c9)) 
		+ u0011*(6*(c28) + 8*(-c22 + c27) + 2*(c11 - c19 - c33 + c36 - c7) + 4*(-c10 + c14 + c15 - c20 - c23 + c24 - c9)) 
		+ u0002*(3*(-c10 + c14 + c15 - c22 - c23 + c27 + c28 - c9) + (c11 - c13 + c17 - c20 + c24 - c26 + c30 - c7))
	);
}



struct return_t
{
	vec4		gradient;
	float[6]	d2;
};


#define _1 0
#define _2 1
#define _3 2
#define _4 3
#define _5 4
#define _6 5

ivec3[24] map_T_expr = ivec3[24](
	ivec3(_1,_3,_5), ivec3(_1,_4,_6), ivec3(_2,_3,_6), ivec3(_2,_4,_5), ivec3(_2,_4,_5), ivec3(_2,_3,_6), ivec3(_1,_4,_6), ivec3(_1,_3,_5),
	ivec3(_3,_5,_1), ivec3(_3,_6,_2), ivec3(_4,_5,_2), ivec3(_4,_6,_1), ivec3(_4,_6,_1), ivec3(_4,_5,_2), ivec3(_3,_6,_2), ivec3(_3,_5,_1),
	ivec3(_5,_1,_3), ivec3(_5,_2,_4), ivec3(_6,_1,_4), ivec3(_6,_2,_3), ivec3(_6,_2,_3), ivec3(_6,_1,_4), ivec3(_5,_2,_4), ivec3(_5,_1,_3)
);



vec3 compute_gradient(vec3 p_in)
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
	int	idx_xfm = 4*((type_R.x+1)>>1) + 2*((type_R.y+1)>>1) + ((type_R.z+1)>>1) + (type_P<<3);
	float[6] val_T;
	switch(type_tet)
	{
		case 0:
			val_T[_1] = eval_T_expr_b1();
			val_T[_2] = eval_T_expr_b2();
			val_T[_3] = eval_T_expr_b3();
			val_T[_4] = eval_T_expr_b4();
			val_T[_5] = eval_T_expr_b5();
			val_T[_6] = eval_T_expr_b6();
			break;
		case 1:
			val_T[_1] = eval_T_expr_g1();
			val_T[_2] = eval_T_expr_g2();
			val_T[_3] = eval_T_expr_g3();
			val_T[_4] = eval_T_expr_g4();
			val_T[_5] = eval_T_expr_g5();
			val_T[_6] = eval_T_expr_g6();
			break;
		case 2:
			val_T[_1] = eval_T_expr_r1();
			val_T[_2] = eval_T_expr_r2();
			val_T[_3] = eval_T_expr_r3();
			val_T[_4] = eval_T_expr_r4();
			val_T[_5] = eval_T_expr_r5();
			val_T[_6] = eval_T_expr_r6();
			break;
	}


	ivec3	idx = map_T_expr[idx_xfm];
	vec3	T = vec3(float(2*((idx_xfm&0x7)>>2)-1)*val_T[idx.x],
					float(2*(idx_xfm&0x1)-1)*val_T[idx.y],
					float(2*((idx_xfm&0x3)>>1)-1)*val_T[idx.z]);

	vec3	g = 0.5*vec3(T.x+T.y-T.z, T.x-T.y+T.z, -T.x+T.y+T.z)*ONE_OVER_64;

//    return g*scale_axes;
    return g;
}


return_t	compute_output(vec3 p_in)
{
	vec3	g = compute_gradient(p_in);

	float[6] d2 = float[6](0,0,0,0,0,0);

	return return_t(vec4(g,0), d2);
}


void main() {

    vec3 start = texture(tex_front, vTexCoord).xyz*dim;
    vec3 end = texture(tex_back, vTexCoord).xyz*dim;
    
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
            vec3 g = compute_gradient(p);
            fColor = shade_Blinn_Phong(-normalize(mat3(MV)*(p_iso.w*g)), MV*vec4(p_iso.xyz,1), uMaterial[int(0.5*(1.0-p_iso.w))], uLight);
            return;
        }
        voxel_prev = voxel;
        p_prev = p;
    }
    fColor = vec4(1,1,1,1);
}



