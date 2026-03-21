import { type VRM, VRMLoaderPlugin } from "@pixiv/three-vrm";
import * as JoyCon from "joy-con-webhid";
import { type Component, onMount } from "solid-js";
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
import { GLTFLoader, VRButton } from "three/examples/jsm/Addons.js";
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
						vrm.expressionManager?.setValue("happy", 0);
						vrm.expressionManager?.setValue("surprised", 0);
						vrm.expressionManager?.setValue("sad", 0);
						vrm.expressionManager?.setValue("relaxed", 1);
					},
					on: { WALK: "walk", JUMP: "jump" },
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
					on: { IDLE: "react", JUMP: "jump" },
				},
				react: {
					entry: () => {
						actions.idle.fadeOut(0.3);
						actions.walk.fadeOut(0.3);
						actions.react.reset().fadeIn(0.3).play();
						vrm.expressionManager?.setValue("happy", 0);
						vrm.expressionManager?.setValue("relaxed", 0);
						vrm.expressionManager?.setValue("surprised", 1);
						vrm.expressionManager?.setValue("sad", 0);
					},
					on: { REACT_END: "idle" },
				},
				jump: {
					entry: () => {
						actions.idle.fadeOut(0.3);
						actions.walk.fadeOut(0.3);
						actions.react.fadeOut(0.3);
						actions.jump.reset().fadeIn(0.1).play();
						vrm.expressionManager?.setValue("happy", 0);
						vrm.expressionManager?.setValue("relaxed", 0);
						vrm.expressionManager?.setValue("sad", 0);
						vrm.expressionManager?.setValue("surprised", 1);
					},
					on: { JUMP_END: "idle" },
				},
			},
		});

	let mixer: AnimationMixer;
	let vrm: VRM;
	let prev: number | null = null;
	const alpha = 0.9;
	let actions: {
		idle: AnimationAction;
		jump: AnimationAction;
		walk: AnimationAction;
		react: AnimationAction;
	};
	let actor: ActorRefFrom<typeof createMotionMachine>;

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
		renderer.xr.enabled = true;

		const { LookingGlassWebXRPolyfill } = await import(
			//@ts-expect-error
			"@lookingglass/webxr"
		);
		new LookingGlassWebXRPolyfill({
			targetY: -0.2,
			targetZ: 0,
			targetDiam: 1.8,
			fovy: (14 * Math.PI) / 180,
		});

		document.body.appendChild(renderer.domElement);
		document.body.appendChild(VRButton.createButton(renderer));

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
		actions.idle.play();
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

		async function animate() {
			timer.update();
			const delta = timer.getDelta();
			if (vrm) vrm.update(delta);
			if (mixer) mixer.update(delta);
			renderer.render(scene, camera);
		}
		renderer.setAnimationLoop(animate);
	});

	const startTracking = async () => {
		await JoyCon.connectJoyCon();
		const fps = 60;
		const windows: number[] = [];
		let frame: number[] = [];
		setInterval(async () => {
			for (const joyCon of JoyCon.connectedJoyCons.values()) {
				if (joyCon.eventListenerAttached) continue;
				await joyCon.open();
				await joyCon.enableStandardFullMode();
				await joyCon.enableIMUMode();
				await joyCon.enableVibration();
				// @ts-expect-error
				joyCon.addEventListener("hidinput", ({ detail }) => {
					const norm = Math.sqrt(
						detail.accelerometers[2].x.acc ** 2 +
							detail.accelerometers[2].y.acc ** 2 +
							detail.accelerometers[2].z.acc ** 2,
					);
					if (prev === null) {
						prev = norm;
						return;
					}
					prev = alpha * prev + (1 - alpha) * norm;
					const high = norm - prev;

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

					if (windows.length >= 4 && windows.slice(-3).every((v) => v > 0.3)) {
						actor.send({ type: "WALK" });
					} else if (prev < 0.5) {
						actor.send({ type: "JUMP" });
					} else {
						actor.send({ type: "IDLE" });
					}

					frame.push(high);
				});
				joyCon.eventListenerAttached = true;
			}
		}, 2000);
	};

	return (
		<button
			type="button"
			style={{ position: "absolute" }}
			onclick={startTracking}
		>
			Start Tracking
		</button>
	);
};

export default App;
