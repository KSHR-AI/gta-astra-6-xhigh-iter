import './style.css';
import('./main.js').catch((error) => {
  console.error('Pacific Heat startup failed:', error);
  document.querySelector('#app').innerHTML = `<section class="startup-error"><span>PACIFIC HEAT</span><h1>A little more<br>horsepower.</h1><p>This 3D city needs WebGL 2. Enable hardware acceleration in your browser, or try a current version of Chrome, Edge, Firefox, or Safari.</p><button type="button" onclick="location.reload()">Try again →</button></section>`;
});
