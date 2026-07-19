<script lang="ts">
  let open = $state(false);

  const apps = [
    { id: "chat",     label: "Chat",     icon: "💬", href: "https://etzhayyim.com",       live: true  },
    { id: "vault",    label: "Vault",    icon: "🔒", href: "https://vault.etzhayyim.com", live: true  },
    { id: "drive",    label: "Drive",    icon: "📁", href: null,                    live: false },
    { id: "mail",     label: "Mail",     icon: "✉️",  href: null,                    live: false },
    { id: "calendar", label: "Calendar", icon: "📅", href: null,                    live: false },
    { id: "docs",     label: "Docs",     icon: "📄", href: null,                    live: false },
  ];

  function toggle() { open = !open; }
  function close() { open = false; }
</script>

<div class="launcher">
  <button class="grid-btn" onclick={toggle} aria-label="App launcher" title="Apps" class:active={open}>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="1" width="4" height="4" rx="1"/>
      <rect x="6" y="1" width="4" height="4" rx="1"/>
      <rect x="11" y="1" width="4" height="4" rx="1"/>
      <rect x="1" y="6" width="4" height="4" rx="1"/>
      <rect x="6" y="6" width="4" height="4" rx="1"/>
      <rect x="11" y="6" width="4" height="4" rx="1"/>
      <rect x="1" y="11" width="4" height="4" rx="1"/>
      <rect x="6" y="11" width="4" height="4" rx="1"/>
      <rect x="11" y="11" width="4" height="4" rx="1"/>
    </svg>
  </button>

  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={close}></div>
    <div class="menu">
      <p class="menu-title">etzhayyim.com Apps</p>
      <div class="grid">
        {#each apps as app}
          {#if app.live && app.href}
            <a href={app.href} class="tile" onclick={close}>
              <span class="tile-icon">{app.icon}</span>
              <span class="tile-label">{app.label}</span>
            </a>
          {:else}
            <div class="tile disabled">
              <span class="tile-icon">{app.icon}</span>
              <span class="tile-label">{app.label}</span>
              <span class="soon">Soon</span>
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .launcher { position: relative; }

  .grid-btn {
    display: flex; align-items: center; justify-content: center;
    width: 32px; height: 32px;
    background: none; border: none; border-radius: 6px;
    color: #7880a0;
  }
  .grid-btn:hover, .grid-btn.active { background: #232735; color: #e6e7e9; }

  .backdrop { position: fixed; inset: 0; z-index: 49; }

  .menu {
    position: absolute; top: calc(100% + 8px); left: 0;
    background: #1a1f2e; border: 1px solid #2f3445; border-radius: 12px;
    padding: 14px; z-index: 50; width: 220px;
    box-shadow: 0 8px 32px rgba(0,0,0,.5);
  }
  .menu-title { margin: 0 0 10px; font-size: 11px; color: #555c75; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }

  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }

  .tile {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 4px; padding: 10px 4px; border-radius: 8px;
    text-decoration: none; color: #b9bcc4; font-size: 11px; position: relative;
    min-height: 64px;
  }
  a.tile:hover { background: #232735; color: #e6e7e9; }
  .tile.disabled { color: #404660; cursor: default; }

  .tile-icon { font-size: 20px; line-height: 1; }
  .tile-label { font-size: 11px; }

  .soon {
    position: absolute; top: 5px; right: 5px;
    font-size: 8px; background: #2a3044; color: #555c75;
    padding: 1px 4px; border-radius: 3px; font-weight: 600; letter-spacing: 0.03em;
  }
</style>
