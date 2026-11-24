import DefaultTheme from 'vitepress/theme-without-fonts';
import { h } from 'vue';
import 'virtual:lawcheck-brand.css';
import '../../theme/fonts.css';
import './docs.css';
import Lockup from '../../theme/Lockup.vue';
import Chapter from './Chapter.vue';

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'nav-bar-title-before': () => h(Lockup), 'doc-before': () => h(Chapter) }),
};
