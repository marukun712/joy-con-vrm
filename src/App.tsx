import { type VRM, VRMLoaderPlugin } from "@pixiv/three-vrm";
import * as JoyCon from "joy-con-webhid";
import { type Component, onMount } from "solid-js";
import {
	AmbientLight,
	PerspectiveCamera,
	Scene,
	Timer,
	WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/Addons.js";

const App: Component = () => {
	let vrm: VRM;

	onMount(() => {
		const scene = new Scene();
		const camera = new PerspectiveCamera(
			75,
			window.innerWidth / window.innerHeight,
			0.1,
			1000,
		);
		const light = new AmbientLight(0xffffff, 3);
		scene.add(light);
		camera.position.set(0, 0.9, 1.3);

		const renderer = new WebGLRenderer();
		renderer.setSize(window.innerWidth, window.innerHeight);
		document.body.appendChild(renderer.domElement);

		const loader = new GLTFLoader();
		loader.register((p) => {
			return new VRMLoaderPlugin(p);
		});

		loader.load(
			"/models/polka.vrm",

			(gltf) => {
				vrm = gltf.userData.vrm;
				scene.add(vrm.scene);

				vrm.scene.rotation.y = 2 * Math.PI;
				vrm.scene.position.set(0, 0, 0);
			},

			(progress) =>
				console.log(
					"Loading model...",
					100.0 * (progress.loaded / progress.total),
					"%",
				),
			(error) => console.error(error),
		);

		async function animate() {
			const timer = new Timer();
			const delta = timer.getDelta();

			if (vrm) {
				vrm.update(delta);
			}
			renderer.render(scene, camera);

			for (const joyCon of JoyCon.connectedJoyCons.values()) {
				if (joyCon.eventListenerAttached) {
					continue;
				}
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
					if (norm < 0.8) {
						console.log("up");
					}

					if (norm > 1.2) {
						console.log("down");
					}
				});
				joyCon.eventListenerAttached = true;
			}
		}
		renderer.setAnimationLoop(animate);
	});

	const startTracking = async () => {
		await JoyCon.connectJoyCon();
	};

	return (
		<button type="button" onclick={startTracking}>
			Start Tracking
		</button>
	);
};

export default App;
