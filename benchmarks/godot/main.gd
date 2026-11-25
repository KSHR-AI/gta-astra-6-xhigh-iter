extends Node3D

# Separate MeshInstance3D nodes deliberately match the other engine adapters.
const CAR_SCENE = preload("res://assets/ferrari-lod.glb")
const CHARACTER_SCENE = preload("res://assets/Soldier.glb")

var spec: Dictionary
var camera: Camera3D
var animation_players: Array[AnimationPlayer] = []
var begin_callback: JavaScriptObject
var scene_started_us: int
var benchmark_started_us: int = 0
var measured_started_us: int = 0
var previous_frame_us: int = 0
var warmup_us: int = 4_000_000
var duration_us: int = 12_000_000
var running := false
var frame_ms: Array[float] = []
var shadows := false
var info: Dictionary

func _ready() -> void:
	spec = JSON.parse_string(FileAccess.get_file_as_string("res://assets/scene.json"))
	if OS.has_feature("web"):
		shadows = JavaScriptBridge.eval("new URLSearchParams(location.search).get('variant') === 'shadows'")
	else:
		shadows = "--shadows" in OS.get_cmdline_user_args()
	get_viewport().msaa_3d = Viewport.MSAA_DISABLED
	get_viewport().screen_space_aa = Viewport.SCREEN_SPACE_AA_DISABLED
	get_viewport().use_taa = false
	get_viewport().use_debanding = false
	_build_environment()
	_build_geometry()
	_build_actors()
	_build_camera()
	scene_started_us = Time.get_ticks_usec()
	info = {
		"engine": "Godot",
		"version": Engine.get_version_info().string,
		"backend": "WebGL2 / Compatibility" if OS.has_feature("web") else "native / headless validation",
		"width": int(spec.width), "height": int(spec.height), "pixelRatio": 1,
		"antialias": false, "threads": false, "shadows": shadows,
		"counts": {"buildings": 64, "cars": 2, "characters": animation_players.size()},
		"notes": [
			"Godot uses its own Compatibility PBR, ambient-light interpretation and frustum culling; lighting is not pixel-identical across engines.",
			"No generated mesh LODs or shadow meshes. Four independent skinned Walk animations. 64 separate building nodes share one box mesh.",
			"Directional shadows use one orthogonal 1024 atlas with hard shadow quality; Godot fits its shadow projection to the camera instead of a fixed 110-unit square.",
			"Raw frame intervals are measured with Time.get_ticks_usec between Godot process frames; JavaScript messaging only occurs at start/end."
		]
	}
	var geometry := _count_geometry(self)
	info["meshInstances"] = geometry[0]
	info["triangles"] = geometry[1]
	if OS.has_feature("web"):
		begin_callback = JavaScriptBridge.create_callback(_on_js_begin)
		JavaScriptBridge.get_interface("window").__astraGodotBegin = begin_callback
		# Let the scene tree and its first animation pose settle before reporting ready.
		await get_tree().process_frame
		await get_tree().process_frame
		JavaScriptBridge.eval("window.__astraGodotReady(%s)" % JSON.stringify(info))
	else:
		print("ASTRA_GODOT_READY " + JSON.stringify(info))

func _build_environment() -> void:
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color(spec.background)
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color(spec.ambient.color)
	environment.ambient_light_energy = float(spec.ambient.intensity)
	environment.ambient_light_sky_contribution = 0.0
	environment.reflected_light_source = Environment.REFLECTION_SOURCE_DISABLED
	environment.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	environment.glow_enabled = false
	environment.ssao_enabled = false
	environment.ssr_enabled = false
	var world_environment := WorldEnvironment.new()
	world_environment.environment = environment
	add_child(world_environment)
	var sun := DirectionalLight3D.new()
	sun.light_color = Color(spec.sun.color)
	sun.light_energy = float(spec.sun.intensity)
	sun.shadow_enabled = shadows
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	sun.directional_shadow_max_distance = 110.0
	sun.shadow_blur = 0.0
	sun.light_angular_distance = 0.0
	add_child(sun)
	sun.position = _vec(spec.sun.position)
	sun.look_at(Vector3.ZERO, Vector3.UP)

func _material(hex_color: String) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(hex_color)
	material.roughness = 0.85
	material.metallic = 0.0
	return material

func _build_geometry() -> void:
	var box_mesh := BoxMesh.new()
	box_mesh.size = Vector3.ONE
	var ground := MeshInstance3D.new()
	ground.name = "Ground"
	ground.mesh = box_mesh
	ground.material_override = _material(spec.ground.color)
	ground.scale = Vector3(float(spec.ground.size), 0.2, float(spec.ground.size))
	ground.position.y = -0.1
	add_child(ground)
	var materials: Array[StandardMaterial3D] = []
	for color in spec.buildings.colors:
		materials.append(_material(color))
	for row in int(spec.buildings.rows):
		for column in int(spec.buildings.columns):
			var height := 4.0 + float((row * 13 + column * 7) % 14)
			var building := MeshInstance3D.new()
			building.name = "Building_%d_%d" % [row, column]
			building.mesh = box_mesh
			building.material_override = materials[(row + column) % materials.size()]
			building.scale = Vector3(float(spec.buildings.width), height, float(spec.buildings.depth))
			var x := (column - 3.5) * float(spec.buildings.spacing)
			var z := (row - 3.5) * float(spec.buildings.spacing)
			var road_offset := float(spec.buildings.get("roadOffset", 0.0))
			x += signf(x) * road_offset
			z += signf(z) * road_offset
			building.position = Vector3(x, height / 2.0, z)
			add_child(building)

func _build_actors() -> void:
	for position_data in spec.assets.car.positions:
		var car: Node3D = CAR_SCENE.instantiate()
		add_child(car)
		car.position = _vec(position_data)
		car.rotation.y = float(spec.assets.car.yaw)
		_set_mesh_options(car)
	for position_data in spec.assets.character.positions:
		var character: Node3D = CHARACTER_SCENE.instantiate()
		add_child(character)
		character.position = _vec(position_data)
		_set_mesh_options(character)
		var players := character.find_children("*", "AnimationPlayer", true, false)
		assert(not players.is_empty(), "Soldier must have its imported animation player")
		var player: AnimationPlayer = players[0]
		var clip: String = spec.assets.character.clip
		assert(player.has_animation(clip), "Soldier Walk clip must be available")
		player.get_animation(clip).loop_mode = Animation.LOOP_LINEAR
		player.play(clip)
		animation_players.append(player)

func _set_mesh_options(node: Node) -> void:
	if node is MeshInstance3D:
		node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		# Never select an automatically generated LOD during the orbit.
		node.lod_bias = 1000.0
	for child in node.get_children():
		_set_mesh_options(child)

func _build_camera() -> void:
	camera = Camera3D.new()
	camera.fov = float(spec.camera.fovDegrees)
	camera.keep_aspect = Camera3D.KEEP_HEIGHT
	camera.near = float(spec.camera.near)
	camera.far = float(spec.camera.far)
	camera.current = true
	add_child(camera)
	_move_camera(0.0)

func _move_camera(seconds: float) -> void:
	var angle := seconds * float(spec.camera.orbitRadiansPerSecond)
	camera.position = Vector3(sin(angle) * float(spec.camera.radius), float(spec.camera.height), cos(angle) * float(spec.camera.radius))
	camera.look_at(_vec(spec.camera.target), Vector3.UP)

func _vec(values: Array) -> Vector3:
	return Vector3(float(values[0]), float(values[1]), float(values[2]))

func _count_geometry(node: Node) -> Array[int]:
	var meshes := 0
	var triangles := 0
	if node is MeshInstance3D and node.mesh:
		meshes += 1
		for surface in node.mesh.get_surface_count():
			var arrays: Array = node.mesh.surface_get_arrays(surface)
			var indices = arrays[Mesh.ARRAY_INDEX]
			triangles += (indices.size() if indices != null and indices.size() > 0 else arrays[Mesh.ARRAY_VERTEX].size()) / 3
	for child in node.get_children():
		var child_counts := _count_geometry(child)
		meshes += child_counts[0]
		triangles += child_counts[1]
	return [meshes, triangles]

func _on_js_begin(arguments: Array) -> void:
	var options: Dictionary = JSON.parse_string(str(arguments[0])) if not arguments.is_empty() else {}
	warmup_us = int(maxf(0.0, float(options.get("warmupMs", spec.warmupMs))) * 1000.0)
	duration_us = int(maxf(100.0, float(options.get("durationMs", spec.durationMs))) * 1000.0)
	benchmark_started_us = Time.get_ticks_usec()
	measured_started_us = 0
	previous_frame_us = 0
	frame_ms.clear()
	for player in animation_players:
		player.seek(0.0, true)
	running = true
	_move_camera(0.0)

func _process(_delta: float) -> void:
	if camera == null:
		return
	var now := Time.get_ticks_usec()
	var origin := benchmark_started_us if running else scene_started_us
	_move_camera(float(now - origin) / 1_000_000.0)
	if not running or now - benchmark_started_us < warmup_us:
		return
	if measured_started_us == 0:
		measured_started_us = now
		previous_frame_us = now
		return
	frame_ms.append(float(now - previous_frame_us) / 1000.0)
	previous_frame_us = now
	if now - measured_started_us >= duration_us:
		running = false
		info["drawCalls"] = int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))
		var result := {"frameMs": frame_ms, "elapsedMs": float(now - measured_started_us) / 1000.0, "info": info}
		if OS.has_feature("web"):
			JavaScriptBridge.eval("window.__astraGodotFinish(%s)" % JSON.stringify(result))
		else:
			print("ASTRA_GODOT_RESULT " + JSON.stringify(result))
