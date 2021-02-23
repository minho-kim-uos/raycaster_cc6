"""
raycaster_cc6.py

# Copyright (c) 2021, Minho Kim
# Computer Graphics Lab, Dept. of Computer Science, University of Seoul
# All rights reserved.

"""
from OpenGL.GL import *
import numpy as np
import os
import glfw
import glm

class VolumeInfo:
    def __init__(self, filename, dtype, dim, scale, level, inverted):
        self.filename = filename
        self.dtype = dtype
        self.dim = dim
        self.scale = scale
        self.level = level
        self.inverted = inverted

try:
    path_volume = os.environ['VOLUME_PATH']
except:
    path_volume = './'

volumes = {
    'ML_25' :VolumeInfo(path_volume + 'ML_25_f32.raw', np.float32, (49,49,49), (1,1,1), 0.5, False),
    'ML_50' :VolumeInfo(path_volume + 'ML_50_f32.raw', np.float32, (99,99,99), (1,1,1), 0.5, False),
    }

###################################################################################################################
# bounding box of the volume
#
# - the bounding box may be composed of smaller min/max boxes for culling
###################################################################################################################
class BBox:
    # dim: resolution of the volume dataset
    # scale: scaling of the volume dataset. Strictly speaking, if scale is not (1,1,1) 
    #        then we get a different lattice.
#------------------------------------------------------------------------------------------------------------------------ 
    def __init__(self, _dim, scale, size_fbo):
        self.dim = _dim

        self.fbo = FBO_bbox(size_fbo[0], size_fbo[1])

        # - Shaders to render the bounding box containing the whole volume.
        # - Used to set the starting/ending point of each ray.
        # - Less efficient than using `bbox_minmax.*' shaders.
        # - Used when `minmax' parameter of `render' function is FALSE.
        self.prog_bbox = Program('bbox.vert', 'bbox.frag', ['MVP', 'scale'])  

        self.size = self.dim

        # - Used to fit the whole volume in viewport by re-scaling.
        self.size_max = max(self.size)

        # - The scaling of the bounding box.
        # - We obtain the properly scaled bounding box by applying this to a unit cube.
        self.scale_bbox = tuple(self.size[i]/self.size_max for i in range(3))

        # - Used to convert from [0,1]^3 space to the lattice space.
        # - Passed as `scale_axes' to raycasting shader.
        self.scale_axes = tuple(((self.dim[i])*self.size[i])/self.size_max for i in range(3))

        positions = np.array([  0, 0, 1,
                                1, 0, 1,
                                1, 1, 1,
                                0, 1, 1,
                                0, 0, 0,
                                1, 0, 0,
                                1, 1, 0,
                                0, 1, 0],
                                dtype=np.float32)
        indices = np.array([    0, 1, 2, 2, 3, 0, # front
                                1, 5, 6, 6, 2, 1, # top
                                7, 6, 5, 5, 4, 7, # back
                                4, 0, 3, 3, 7, 4, # bottom
                                4, 5, 1, 1, 0, 4, # left
                                3, 2, 6, 6, 7, 3 # right
                                ], dtype=np.int8)
 
        # Setting up the VAO for the bbox
        self.vao = glGenVertexArrays(1)
        glBindVertexArray(self.vao)

        self.vbo_position = glGenBuffers(1)
        glBindBuffer(GL_ARRAY_BUFFER, self.vbo_position)
        glBufferData(GL_ARRAY_BUFFER, len(positions)*ctypes.sizeof(ctypes.c_float), positions, GL_STATIC_DRAW)
        glEnableVertexAttribArray(0)
        glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 0, None)

        self.vbo_idx = glGenBuffers(1)
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, self.vbo_idx)
        self.size_indices = len(indices)
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, len(indices)*ctypes.sizeof(ctypes.c_ubyte), indices, GL_STATIC_DRAW)

        glBindVertexArray(0)

#------------------------------------------------------------------------------------------------------------------------ 
    def render(self, MVP):
        glUseProgram(self.prog_bbox.id)
        glUniformMatrix4fv(self.prog_bbox.uniform_locs['MVP'], 1, GL_FALSE, MVP)
        glUniform3fv(self.prog_bbox.uniform_locs['scale'], 1, self.scale_bbox)
        glBindVertexArray(self.vao)
        glDrawElements(GL_TRIANGLES, self.size_indices, GL_UNSIGNED_BYTE, ctypes.c_void_p(0))
        glBindVertexArray(0)
        glUseProgram(0)

#------------------------------------------------------------------------------------------------------------------------ 
    def render_backfaces(self, MVP):
        glDepthFunc(GL_GREATER)
        glClearDepth(0)
        glClearColor(0, 0, 0, 1)
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT )
        glEnable(GL_CULL_FACE)
        glCullFace(GL_FRONT)
        self.render(MVP)
        glDisable(GL_CULL_FACE)

#------------------------------------------------------------------------------------------------------------------------ 
    def render_frontfaces(self, MVP):
        glDepthFunc(GL_LESS)
        glClearDepth(1)
        glClearColor(0, 0, 0, 1)
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT )
        glEnable(GL_CULL_FACE)
        glCullFace(GL_BACK)
        self.render(MVP)
        glDisable(GL_CULL_FACE)

#------------------------------------------------------------------------------------------------------------------------ 
    def render_bbox(self, MVP):
        glViewport(0, 0, self.fbo.width, self.fbo.height)
        glBindFramebuffer(GL_FRAMEBUFFER, self.fbo.fbo)
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, self.fbo.buf_back, 0)
        self.render_backfaces(MVP)
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, self.fbo.buf_front, 0)
        self.render_frontfaces(MVP)
        glBindFramebuffer(GL_FRAMEBUFFER, 0)

###################################################################################################################
class Volume:

#------------------------------------------------------------------------------------------------------------------------ 
    def __init__(self, info, size_fbo_bbox):

        self.load_data(info)

        self.bbox = BBox(self.info.dim, self.info.scale, size_fbo_bbox)

        self.dim_tex = [self.info.dim[0], self.info.dim[1], self.info.dim[2], 1]

        self.upload_data()
       
#------------------------------------------------------------------------------------------------------------------------ 
    def load_data(self, info):
        self.info = info
        scale = 1

        self.dim_max = max(max(self.info.dim[0], self.info.dim[1]), self.info.dim[2])
       
        # Always keep in float32 format...
        self.data = np.fromfile(info.filename, dtype=info.dtype).astype(np.float32)*scale

#------------------------------------------------------------------------------------------------------------------------ 
    def upload_data(self):
        if self.dim_tex[3] == 1:
            internal_format = GL_R32F
            format = GL_RED
        elif self.dim_tex[3] == 2:
            internal_format = GL_RG32F
            format = GL_RG

        self.texid = glGenTextures(1)
        glPixelStorei(GL_UNPACK_ALIGNMENT,1)
        glBindTexture(GL_TEXTURE_3D, self.texid)
        glTexParameterf(GL_TEXTURE_3D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
        glTexParameterf(GL_TEXTURE_3D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
        glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_BORDER)
        glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_BORDER)
        glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_R, GL_CLAMP_TO_BORDER)
        glTexImage3D(GL_TEXTURE_3D, 0, internal_format, self.dim_tex[0], self.dim_tex[1], self.dim_tex[2], 0, format, GL_FLOAT, self.data)
        glBindTexture(GL_TEXTURE_3D, 0)

        self.data = None
###################################################################################################################
class FBO_bbox:
    def __init__(self, width, height):
        self.width = width
        self.height = height

        self.fbo = glGenFramebuffers(1)
        glBindFramebuffer(GL_FRAMEBUFFER, self.fbo)

        self.buf_back = glGenTextures(1)
        glBindTexture(GL_TEXTURE_2D, self.buf_back)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_BORDER)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_BORDER)
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA32F, width, height, 0, GL_RGBA, GL_FLOAT, None)
        glBindTexture(GL_TEXTURE_2D, 0)

        self.buf_front = glGenTextures(1)
        glBindTexture(GL_TEXTURE_2D, self.buf_front)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_BORDER)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_BORDER)
        glTexImage2D(GL_TEXTURE_2D, 0,GL_RGBA32F, width, height, 0, GL_RGBA, GL_FLOAT, None)
        glBindTexture(GL_TEXTURE_2D, 0)

        self.rbo = glGenRenderbuffers(1)
        glBindRenderbuffer(GL_RENDERBUFFER, self.rbo)
        glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT, width, height)
        glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, self.rbo)
        glBindRenderbuffer(GL_RENDERBUFFER, 0)

        glBindFramebuffer(GL_FRAMEBUFFER, 0)


###################################################################################################################
class QuadFull:
    RENDER_MODE_BLINN_PHONG = 0
    RENDER_MODE_CURVATURE = 1
    NUM_RENDER_MODE = 2
    def __init__(self, volume, size_fbo):
        self.tex_bbox_back = volume.bbox.fbo.buf_back
        self.tex_bbox_front = volume.bbox.fbo.buf_front
        self.tex_volume = volume.texid

        self.render_mode = self.RENDER_MODE_CURVATURE

        uniforms = ['tex_back', 'tex_front', 'tex_volume', 'scale_axes', 'dim', 
                    'level', 'scale_step', 'MV', 'render_mode', 'tex_colormap_2d']

        self.prog = Program('raycast_simple.vert', 'cc6_raycast_open.frag', uniforms)

        self.init_colormap()

        self.init_vao()

        self.scale_step = 0.001

#------------------------------------------------------------------------------------------------------------------------ 
    def init_vao(self):
        verts = np.array(
            [-1, -1, 0, 0,
              1, -1, 1, 0,
              1,  1, 1, 1,
             -1,  1, 0, 1], dtype=np.float32)

        self.vao = glGenVertexArrays(1)
        glBindVertexArray(self.vao)
        self.vbo = glGenBuffers(1)
        glBindBuffer(GL_ARRAY_BUFFER, self.vbo)
        glBufferData(GL_ARRAY_BUFFER, len(verts)*ctypes.sizeof(ctypes.c_float), verts, GL_STATIC_DRAW)
        glEnableVertexAttribArray(0)
        glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 4*ctypes.sizeof(ctypes.c_float), None)
        glEnableVertexAttribArray(1)
        glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 4*ctypes.sizeof(ctypes.c_float), ctypes.c_void_p(2*ctypes.sizeof(ctypes.c_float)))
        glBindVertexArray(0)
#------------------------------------------------------------------------------------------------------------------------ 
    def render_raycast_shading(self, level, volume, MV):

        glClearColor(0, 0, 0, 0)
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)
        glActiveTexture(GL_TEXTURE0)
        glBindTexture(GL_TEXTURE_2D, self.tex_bbox_back)
        glActiveTexture(GL_TEXTURE1)
        glBindTexture(GL_TEXTURE_2D, self.tex_bbox_front)
        glActiveTexture(GL_TEXTURE2)
        glBindTexture(GL_TEXTURE_3D, self.tex_volume)
        glActiveTexture(GL_TEXTURE3)
        glBindTexture(GL_TEXTURE_2D, self.tex_colormap_2d)

        glUseProgram(self.prog.id)

        glUniform1i(self.prog.uniform_locs['tex_back'], 0)   
        glUniform1i(self.prog.uniform_locs['tex_front'], 1) 
        glUniform1i(self.prog.uniform_locs['tex_volume'], 2)
        glUniform1i(self.prog.uniform_locs['tex_colormap_2d'], 3)
        glUniform1f(self.prog.uniform_locs['level'], level)
        glUniform3f(self.prog.uniform_locs['scale_axes'], volume.bbox.scale_axes[0], volume.bbox.scale_axes[1], volume.bbox.scale_axes[2])
        glUniform3f(self.prog.uniform_locs['dim'], volume.info.dim[0], volume.info.dim[1], volume.info.dim[2])
        glUniform1f(self.prog.uniform_locs['scale_step'], self.scale_step)
        glUniformMatrix4fv(self.prog.uniform_locs['MV'], 1, GL_FALSE, MV)
        glUniform1i(self.prog.uniform_locs['render_mode'], self.render_mode);

        glBindVertexArray(self.vao)
        glDrawArrays(GL_TRIANGLE_FAN, 0, 4)
        glBindVertexArray(0)

#------------------------------------------------------------------------------------------------------------------------ 
    def init_colormap(self):
# 3x3 colormap for min-max curvature
        colormap_2d = np.array([[ 1, 0, 0], [ 1, 1, 0], [0,1,0],
                                [.5,.5,.5], [.5,.5,.5], [0,1,1],
                                [.5,.5,.5], [.5,.5,.5], [0,0,1]], dtype=np.float32)
        self.tex_colormap_2d = glGenTextures(1)
        glBindTexture(GL_TEXTURE_2D, self.tex_colormap_2d)
        glPixelStorei(GL_UNPACK_ALIGNMENT,1)
        glTexParameterf(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
        glTexParameterf(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
        glTexParameterf(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE)
        glTexParameterf(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)

        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 3, 3, 0, GL_RGB, GL_FLOAT, colormap_2d)

###################################################################################################################
class Program:
    def __init__(self, filename_vert, filename_frag, uniforms):
        src_vert = open(filename_vert, 'r').read()
        src_frag = open(filename_frag, 'r').read()
        self.id = self.build(src_vert, src_frag, uniforms)

#------------------------------------------------------------------------------------------------------------------------ 
    def compile(self, src, type):
            
        id = glCreateShader(type)
        glShaderSource(id, src)
        glCompileShader(id)
        result = glGetShaderiv(id, GL_COMPILE_STATUS)
        
        if not(result):
            print('shader compilation error.')
            print(glGetShaderInfoLog(id))
            input('press any key to continue.')
            raise RuntimeError(
                """Shader compile failure (%s): %s"""%( result, glGetShaderInfoLog( id ),),
                src, type,)
        return id

#------------------------------------------------------------------------------------------------------------------------ 
    def build(self, src_vert, src_frag, uniforms):
        id_vert = self.compile(src_vert, GL_VERTEX_SHADER)
        id_frag = self.compile(src_frag, GL_FRAGMENT_SHADER)
        program = glCreateProgram()
        if not program:
            raise RunTimeError('glCreateProgram faled!')
    
        glAttachShader(program, id_vert)
        glAttachShader(program, id_frag)
        glLinkProgram(program)
        status = glGetProgramiv(program, GL_LINK_STATUS)
        if not status:
            infoLog = glGetProgramInfoLog(program)
            glDeleteProgram(program)
            glDeleteShader(id_vert)
            glDeleteShader(id_frag)
            print(infoLog)
            raise RuntimeError("Error linking program:\n%s\n", infoLog)

        self.uniform_locs = {}
        for u in uniforms:
            self.uniform_locs[u] = glGetUniformLocation(program, u)
        return program


###################################################################################################################
class Scene:    
    def __init__(self, width, height):

        self.width = width
        self.height = height

        self.view_angle = 21
        self.angle_x = 320
        self.angle_y = 0
        self.position_x = 0
        self.position_y = 0


        volume_name = 'ML_25'
#        volume_name = 'ML_50'

        fbo_size = (width, height)

        self.volume = Volume(volumes[volume_name], fbo_size)

        self.quad_full = QuadFull(self.volume, fbo_size)

        self.refresh_MVP()

        self.texid = [self.volume.bbox.fbo.buf_front, self.volume.bbox.fbo.buf_back]
        
        self.level = volumes[volume_name].level

#------------------------------------------------------------------------------------------------------------------------ 
    def refresh_MVP(self):

        self.P = glm.perspective(np.radians(self.view_angle), self.width/self.height, 1, 3)

        self.MV = glm.translate(glm.mat4(), glm.vec3(self.position_x, self.position_y, -2))
        self.MV = glm.rotate(self.MV, np.radians(self.angle_x), glm.vec3(1,0,0))
        self.MV = glm.rotate(self.MV, np.radians(self.angle_y), glm.vec3(0,1,0))

        self.MVP = np.array(self.P * self.MV)

        self.MV = np.array(self.MV)
#------------------------------------------------------------------------------------------------------------------------ 
    def render_shading(self):
        self.volume.bbox.render_bbox(self.MVP)
        self.quad_full.render_raycast_shading(self.level, self.volume, self.MV) 

###################################################################################################################
class RenderWindow:
    def __init__(self):
        cwd = os.getcwd() # save current working directory
        glfw.init() # initialize glfw - this changes cwd
        os.chdir(cwd) # restore cwd

        glfw.window_hint(glfw.CONTEXT_VERSION_MAJOR, 3)
        glfw.window_hint(glfw.CONTEXT_VERSION_MINOR, 3)
        glfw.window_hint(glfw.OPENGL_FORWARD_COMPAT, GL_TRUE)
        glfw.window_hint(glfw.OPENGL_PROFILE, glfw.OPENGL_CORE_PROFILE)
   
        self.width, self.height = 512, 512
        self.aspect = self.width/float(self.height)
        self.win = glfw.create_window(self.width, self.height, 'raycaster (cc6)', None, None)
        glfw.make_context_current(self.win)

        # for retina display...
        self.fb_width, self.fb_height = glfw.get_framebuffer_size(self.win)

        glEnable(GL_DEPTH_TEST)
        glClearColor(0.0, 0.0, 0.0,0.0)

        glfw.set_key_callback(self.win, self.onKeyboard)
        glfw.set_window_size_callback(self.win, self.onSize)        

        self.scene = Scene(self.fb_width, self.fb_height)

        self.exitNow = False
        
    def onKeyboard(self, win, key, scancode, action, mods):
        if action == glfw.PRESS:
            # ESC to quit
            if key == glfw.KEY_ESCAPE: 
                self.exitNow = True
            elif key == glfw.KEY_RIGHT:
                self.scene.angle_y = (self.scene.angle_y + 10) % 360
                self.scene.refresh_MVP()
            elif key == glfw.KEY_LEFT:
                self.scene.angle_y = (self.scene.angle_y - 10) % 360
                self.scene.refresh_MVP()
            elif key == glfw.KEY_UP:
                self.scene.angle_x = (self.scene.angle_x - 10) % 360
                self.scene.refresh_MVP()
            elif key == glfw.KEY_DOWN:
                self.scene.angle_x = (self.scene.angle_x + 10) % 360
                self.scene.refresh_MVP()
            elif key == glfw.KEY_EQUAL:
                self.scene.level = self.scene.level + set_step_level(mods)
                print(self.scene.level)
            elif key == glfw.KEY_MINUS:
                self.scene.level = self.scene.level - set_step_level(mods)
                print(self.scene.level)
            elif key == glfw.KEY_PAGE_UP:
                self.scene.view_angle = self.scene.view_angle - 1
                self.scene.refresh_MVP()
                print(self.scene.view_angle)
            elif key == glfw.KEY_PAGE_DOWN:
                self.scene.view_angle = self.scene.view_angle + 1
                self.scene.refresh_MVP()
                print(self.scene.view_angle)
            elif key == glfw.KEY_TAB:
                self.scene.quad_full.render_mode = (self.scene.quad_full.render_mode + 1) % self.scene.quad_full.NUM_RENDER_MODE
                print(self.scene.quad_full.render_mode)
        
    def onSize(self, win, width, height):
        self.aspect = width/float(height)
        self.scene.width = width
        self.scene.height = height

    def run(self):
        glfw.set_time(0)
        glClearColor(1,1,1,1)
        lastT = glfw.get_time()
        frames = 0
        while not glfw.window_should_close(self.win) and not self.exitNow:
            currT = glfw.get_time()
            if frames == 20:
                elapsed = currT - lastT
                print('fps = {}'.format(frames/elapsed))
                lastT = currT
                frames = 0
            self.scene.render_shading()
            frames += 1
            glfw.swap_buffers(self.win)
            glfw.poll_events()
        glfw.terminate()

# main() function
def main():
    print("Starting raycaster. "
          "Press ESC to quit.")
    rw = RenderWindow()
    rw.run()

# call main
if __name__ == '__main__':
    main()
