import is from '@sindresorhus/is';
import { regEx } from '../../../util/regex';
import type { PackageDependency, PackageFileContent } from '../types';
import { isComment } from './common';

const regex = regEx(
  `(?<name>[-_a-zA-Z0-9]+)/(?<version>[^@#\n{*"']+)(?<userChannel>@[-_a-zA-Z0-9]+(?:/[^#\n.{*"' ]+|))?#?(?<revision>[-_a-f0-9]+[^\n{*"'])?`,
);

function setDepType(content: string, originalType: string): string {
  let depType = originalType;
  if (content.includes('python_requires')) {
    depType = 'python_requires';
  } else if (content.includes('tool_requires')) {
    depType = 'tool_requires';
  } else if (content.includes('test_requires')) {
    depType = 'test_requires';
  } else if (content.includes('requires') || content.includes('requirements')) {
    depType = 'requires';
  }
  return depType;
}

export function extractPackageFile(
  content: string,
  fileName: string,
): PackageFileContent | null {
  const deps: PackageDependency[] = [];

  function processLine(line: string, depType: string): void {
    const matches = regex.exec(line.trim());
    if (matches?.groups) {
      let dep: PackageDependency = {};
      const depName = matches.groups?.name;
      const currentValue = matches.groups?.version.trim();

      let replaceString = `${depName}/${currentValue}`;
      // conan uses @_/_ as a placeholder for no userChannel
      let userAndChannel = '@_/_';

      if (matches.groups.userChannel) {
        userAndChannel = matches.groups.userChannel;
        replaceString = `${depName}/${currentValue}${userAndChannel}`;
        if (!userAndChannel.includes('/')) {
          userAndChannel = `${userAndChannel}/_`;
        }
      }
      const packageName = `${depName}/${currentValue}${userAndChannel}`;

      dep = {
        ...dep,
        depName,
        packageName,
        currentValue,
        replaceString,
        depType,
      };
      if (matches.groups.revision) {
        dep.currentDigest = matches.groups.revision;
        dep.autoReplaceStringTemplate = `{{depName}}/{{newValue}}${userAndChannel}{{#if newDigest}}#{{newDigest}}{{/if}}`;
        dep.replaceString = `${replaceString}#${dep.currentDigest}`;
      }

      deps.push(dep);
    }
  }
  if (fileName.endsWith('.txt')) {
    const rawLines = content.split('\n').filter(is.nonEmptyString);
    let curSection = '';
    for (const rawLine of rawLines) {
      if (isComment(rawLine)) {
        continue;
      }
      if (rawLine.startsWith('[') && rawLine.endsWith(']')) {
        curSection = rawLine.slice(1, -1);
        continue;
      }
      if (curSection.endsWith('requires')) {
        processLine(rawLine, curSection);
      }
    }
  } else {
    // only process sections where requirements are defined
    const sections = content.split(regEx(/def /)).filter(
      (part) =>
        part.includes('python_requires = ') || // only matches python_requires
        part.startsWith('build_requirements(self):') ||
        part.startsWith('requirements(self):') ||
        part.includes('requires = ') ||
        part.includes('tool_requires = ') ||
        part.includes('test_requires = ') ||
        part.includes('python_requires = '),
    );

    for (const section of sections) {
      let depType = setDepType(section, 'requires');
      const rawLines = section.split('\n').filter(is.nonEmptyString);

      for (const rawLine of rawLines) {
        if (!isComment(rawLine)) {
          depType = setDepType(rawLine, depType);
          // extract all dependencies from each line
          const lines = rawLine.split(regEx(/["'],/));
          for (const line of lines) {
            processLine(line, depType);
          }
        }
      }
    }
  }

  return deps.length ? { deps } : null;
}
