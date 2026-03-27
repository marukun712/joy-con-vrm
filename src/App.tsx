import { type VRM, VRMLoaderPlugin } from "@pixiv/three-vrm";
import { type Component, createSignal, onMount, Show } from "solid-js";
import {
	AmbientLight,
	type AnimationAction,
	AnimationMixer,
	BackSide,
	BoxGeometry,
	DirectionalLight,
	LoopOnce,
	LoopRepeat,
	Mesh,
	MeshStandardMaterial,
	NoToneMapping,
	PerspectiveCamera,
	Scene,
	SRGBColorSpace,
	Timer,
	WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/Addons.js";
import { type ActorRefFrom, createActor, createMachine } from "xstate";
import { loadMixamoAnimation } from "./lib/loadMixamoAnimation";

const App: Component = () => {
	const createMotionMachine = (
		actions: {
			idle: AnimationAction;
			walk: AnimationAction;
			jump: AnimationAction;
			react: AnimationAction;
		},
		vrm: VRM,
	) =>
		createMachine({
			id: "motion",
			initial: "idle",
			states: {
				idle: {
					entry: () => {
						actions.walk.fadeOut(0.3);
						actions.jump.fadeOut(0.3);
						actions.react.fadeOut(0.3);
						actions.idle.reset().fadeIn(0.3).play();
						vrm.expressionManager?.setValue("happy", 0.2);
						vrm.expressionManager?.setValue("surprised", 0);
						vrm.expressionManager?.setValue("sad", 0);
						vrm.expressionManager?.setValue("relaxed", 1);
					},
					on: { WALK: "walk", JUMP: "jump", FALL: "fall" },
				},
				walk: {
					entry: () => {
						actions.idle.fadeOut(0.3);
						actions.jump.fadeOut(0.3);
						actions.walk.reset().fadeIn(0.3).play();
						vrm.expressionManager?.setValue("relaxed", 0);
						vrm.expressionManager?.setValue("surprised", 0);
						vrm.expressionManager?.setValue("sad", 0);
						vrm.expressionManager?.setValue("happy", 1);
					},
					on: { IDLE: "react", JUMP: "jump", FALL: "fall" },
				},
				react: {
					entry: () => {
						actions.idle.fadeOut(0.3);
						actions.walk.fadeOut(0.3);
						actions.react.reset().fadeIn(0.3).play();
						vrm.expressionManager?.setValue("happy", 0.2);
						vrm.expressionManager?.setValue("relaxed", 1);
						vrm.expressionManager?.setValue("surprised", 0);
						vrm.expressionManager?.setValue("sad", 0);
					},
					on: { REACT_END: "idle" },
				},
				jump: {
					entry: () => {
						actions.idle.fadeOut(0.3);
						actions.walk.fadeOut(0.3);
						actions.react.fadeOut(0.3);
						actions.jump.reset().fadeIn(0.3).play();
						vrm.expressionManager?.setValue("happy", 0);
						vrm.expressionManager?.setValue("relaxed", 0);
						vrm.expressionManager?.setValue("sad", 0);
						vrm.expressionManager?.setValue("surprised", 1);
					},
					on: { JUMP_END: "idle" },
				},
			},
		});

	const [started, setStarted] = createSignal(false);

	let interval: number;

	let vrm: VRM;
	let mixer: AnimationMixer;
	let actions: {
		idle: AnimationAction;
		jump: AnimationAction;
		walk: AnimationAction;
		react: AnimationAction;
	};
	let actor: ActorRefFrom<typeof createMotionMachine>;

	const fps = 60;
	const windows: number[] = [];
	let frame: number[] = [];
	let lastAcc = { x: 0, y: 0, z: 0 };
	let lastUpdate = Date.now();

	onMount(async () => {
		const scene = new Scene();
		const camera = new PerspectiveCamera(
			75,
			window.innerWidth / window.innerHeight,
			0.1,
			1000,
		);
		camera.position.set(0, -0.4, 1.8);
		const timer = new Timer();

		const renderer = new WebGLRenderer({ antialias: true });
		renderer.setSize(window.innerWidth, window.innerHeight);
		renderer.setPixelRatio(window.devicePixelRatio);
		renderer.shadowMap.enabled = true;
		renderer.outputColorSpace = SRGBColorSpace;
		renderer.toneMapping = NoToneMapping;
		renderer.toneMappingExposure = 1.0;
		document.body.appendChild(renderer.domElement);

		const light = new AmbientLight(0xffffff, 2.0);
		scene.add(light);
		const dirLight = new DirectionalLight(0xffffff, 1.0);
		dirLight.position.set(2, 4, 2);
		dirLight.castShadow = true;
		scene.add(dirLight);

		const box = new Mesh(
			new BoxGeometry(3, 3, 3),
			new MeshStandardMaterial({ color: 0xffffff, side: BackSide }),
		);
		box.receiveShadow = true;
		scene.add(box);

		const loader = new GLTFLoader();
		loader.register((p) => new VRMLoaderPlugin(p));
		const gltf = await loader.loadAsync("/models/polka.vrm");
		vrm = gltf.userData.vrm;
		vrm.scene.traverse((obj) => {
			obj.castShadow = true;
		});
		scene.add(vrm.scene);
		vrm.scene.position.set(0, -1.5, 0);
		if (vrm.lookAt) vrm.lookAt.target = camera;

		const idle = await loadMixamoAnimation("/models/animations/Idle.fbx", vrm);
		const jump = await loadMixamoAnimation("/models/animations/Jump.fbx", vrm);
		const walk = await loadMixamoAnimation(
			"/models/animations/Walking.fbx",
			vrm,
		);
		const react = await loadMixamoAnimation(
			"/models/animations/Reacting.fbx",
			vrm,
		);
		mixer = new AnimationMixer(vrm.scene);

		actions = {
			idle: mixer.clipAction(idle),
			jump: mixer.clipAction(jump),
			walk: mixer.clipAction(walk),
			react: mixer.clipAction(react),
		};
		actions.idle.setLoop(LoopRepeat, Infinity);
		actions.jump.setLoop(LoopOnce, 1);
		actions.jump.clampWhenFinished = true;
		actions.walk.setLoop(LoopRepeat, Infinity);
		actions.react.setLoop(LoopOnce, 1);
		actions.react.clampWhenFinished = true;

		const motionMachine = createMotionMachine(actions, vrm);
		actor = createActor(motionMachine).start();

		mixer.addEventListener("finished", (e) => {
			if (e.action === actions.jump) actor.send({ type: "JUMP_END" });
			if (e.action === actions.react) actor.send({ type: "REACT_END" });
		});

		onResize();
		window.addEventListener("resize", onResize);

		function onResize() {
			const width = window.innerWidth;
			const height = window.innerHeight;
			renderer.setPixelRatio(devicePixelRatio);
			renderer.setSize(width, height);
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
		}

		let blinkTimer = 0;
		let blinking = false;

		async function animate() {
			timer.update();
			const delta = timer.getDelta();
			const elapsed = timer.getElapsed();

			if (vrm) {
				const spineBone = vrm.humanoid.getNormalizedBoneNode("spine");
				if (spineBone) {
					spineBone.rotation.x = Math.sin(elapsed * 0.8) * 0.003;
				}

				blinkTimer -= delta;
				if (blinkTimer <= 0 && !blinking) {
					blinking = true;
					vrm.expressionManager?.setValue("blink", 1);
					setTimeout(() => {
						vrm.expressionManager?.setValue("blink", 0);
						blinking = false;
						blinkTimer = 2 + Math.random() * 3;
					}, 120);
				}

				vrm.update(delta);
			}
			if (mixer) mixer.update(delta);

			renderer.render(scene, camera);
		}
		renderer.setAnimationLoop(animate);
	});

	window.addEventListener("devicemotion", (event) => {
		lastUpdate = Date.now();
		const acc = event.acceleration;
		if (!acc) return;
		lastAcc = {
			x: acc.x ?? 0,
			y: acc.y ?? 0,
			z: acc.z ?? 0,
		};
	});

	const startTracking = async () => {
		if (interval) return;
		interval = setInterval(() => {
			const acc = lastAcc;
			if (frame.length === fps * 1) {
				const rms = Math.sqrt(
					frame.reduce((a, b) => a + b ** 2, 0) / frame.length,
				);
				windows.push(rms);
				if (windows.length > 4) {
					windows.shift();
				}
				frame = [];
			}

			const now = Date.now();
			if (now - lastUpdate > 300) {
				actor.send({ type: "IDLE" });
				return;
			}

			if (windows.length >= 4 && windows.slice(-3).every((v) => v > 1.5)) {
				actor.send({ type: "WALK" });
			} else if (acc.y > 2.5) {
				actor.send({ type: "JUMP" });
			} else {
				actor.send({ type: "IDLE" });
			}
			const norm = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);
			frame.push(norm);
		}, 1000 / 60);
	};

	const enterFullscreen = () => {
		const el = document.documentElement;
		if (el.requestFullscreen) el.requestFullscreen();
		setStarted(true);
	};

	return (
		<Show when={!started()}>
			<div
				style={{
					position: "absolute",
					display: "flex",
					gap: "8px",
					padding: "8px",
				}}
			>
				<button type="button" onclick={startTracking}>
					Start Tracking
				</button>
				<button type="button" onclick={enterFullscreen}>
					Fullscreen
				</button>
			</div>
		</Show>
	);
};

export default App;
