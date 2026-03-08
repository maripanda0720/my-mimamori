// Tailwind CSS v4 を動かすための PostCSS 設定ファイルです。
export default {
  plugins: {
    // 新しい Tailwind の PostCSS プラグインを指定します。
    '@tailwindcss/postcss': {},
    // ブラウザごとの表示のズレを自動で修正してくれるツールです。
    autoprefixer: {},
  },
}