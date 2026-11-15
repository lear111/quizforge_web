// Synthetic input for the unmodified 5c4eacc page document.
export default {
  context: {
    question: {
      stem: '</script><!--<script>hostile()</script>',
      nested: {
        value: '< & \\"',
      },
    },
    answer: null,
    solution: null,
    result: null,
    item: {
      parts: [
        {
          id: 'p',
        },
      ],
    },
    locked: false,
    can: {
      submit: true,
      retry: false,
    },
    appearance: {
      theme: 'light',
    },
  },
  sources: {
    html: '<section id="test">synthetic</section>',
    js: 'QF.page.register({load(){},getAnswer(){return null;}});',
    css: 'p::before{content:"</style>"}',
    sdks: ['globalThis.syntheticSdk=true;'],
  },
  nonce: 'trusted-nonce',
};
