/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 时间线片段色条状态色
        clip: {
          pending: '#facc15', // 黄：待保存（I/O 之间）
          saved: '#3b82f6', // 蓝：已保存片段
          active: '#22d3ee', // 青：当前激活片段
          in: '#22c55e', // 绿：入点标记
          out: '#ef4444' // 红：出点标记
        }
      }
    }
  },
  plugins: []
}
