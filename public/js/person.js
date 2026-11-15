/*
 * « Qui utilise l'app ? » — bouton en haut à droite (à côté de « Tutoriel »), aussi sur le kiosque et l'inventaire du
 * téléphone. Choisir son nom met l'interface dans SA langue (Réglages → Équipe) ; on peut aussi choisir seulement une
 * langue. Le choix est mémorisé sur l'appareil (rpq.person / rpq.lang) ; si la langue d'une personne change dans les
 * Réglages, elle suit au prochain chargement.
 */
const PERSON_KEY = 'rpq.person';
const SHORT = { fr: 'FR', en: 'EN', es: 'ES', fil: 'FIL' };

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : le choix vaut pour cette page */
  }
};

let team = [];

const loadTeam = async () => {
  try {
    const response = await fetch('/api/team');
    team = response.ok ? (await response.json()).members ?? [] : [];
  } catch {
    team = [];
  }
  return team;
};

/** La personne mémorisée sur cet appareil, avec sa langue à jour. */
export const currentPerson = () => {
  const name = read(PERSON_KEY);
  return name ? team.find((member) => member.name === name) ?? { name, lang: null } : null;
};

const apply = () => {
  const person = currentPerson();
  if (person?.lang) globalThis.RQI18n?.setLang(person.lang);
};

const label = (button) => {
  const person = currentPerson();
  const lang = globalThis.RQI18n?.getLang() ?? 'fr';
  button.replaceChildren(
    Object.assign(document.createElement('span'), { textContent: person ? '👤' : '🌐' }),
    Object.assign(document.createElement('span'), { textContent: person ? `${person.name} · ${SHORT[lang]}` : SHORT[lang] }),
  );
};

/** Monte le sélecteur sur `button` (un <button> déjà dans la page). */
export const mountPersonPicker = async (button) => {
  if (!button) return;
  button.setAttribute('data-no-i18n', ''); // les noms ne se traduisent pas
  await loadTeam();
  apply();
  label(button);
  globalThis.RQI18n?.onChange(() => label(button));

  let menu = null;
  const close = () => {
    menu?.remove();
    menu = null;
  };
  const choose = (member, lang) => {
    write(PERSON_KEY, member ? member.name : null);
    globalThis.RQI18n?.setLang(member ? member.lang : lang);
    label(button);
    close();
  };
  const row = (text, sub, on, onClick) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `person-item${on ? ' is-on' : ''}`;
    item.append(Object.assign(document.createElement('span'), { textContent: text }));
    if (sub) item.append(Object.assign(document.createElement('small'), { textContent: sub }));
    item.addEventListener('click', onClick);
    return item;
  };

  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (menu) return close();
    await loadTeam();
    const person = currentPerson();
    const lang = globalThis.RQI18n?.getLang() ?? 'fr';
    menu = document.createElement('div');
    menu.className = 'person-menu';
    const title = Object.assign(document.createElement('div'), { className: 'person-title', textContent: 'Qui utilise l’app ?' });
    menu.append(title);
    if (team.length) {
      for (const member of team) {
        const item = row(member.name, globalThis.RQI18n?.LANGS[member.lang] ?? member.lang, person?.name === member.name, () => choose(member));
        item.setAttribute('data-no-i18n', '');
        menu.append(item);
      }
    } else {
      menu.append(Object.assign(document.createElement('p'), { className: 'person-hint', textContent: 'Ajoute l’équipe dans Réglages → Équipe.' }));
    }
    menu.append(Object.assign(document.createElement('div'), { className: 'person-title', textContent: 'Langue seulement' }));
    for (const [code, name] of Object.entries(globalThis.RQI18n?.LANGS ?? {})) {
      const item = row(name, null, !person && lang === code, () => choose(null, code));
      item.setAttribute('data-no-i18n', '');
      menu.append(item);
    }
    const rect = button.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    document.body.append(menu);
    setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
  });
};
