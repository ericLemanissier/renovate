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
  } else if (content.includes('build_requirements')) {
    depType = 'build_requirements';
  } else if (content.includes('requires') || content.includes('requirements')) {
    depType = 'requires';
  }
  return depType;
}

export function extractPackageFile(content: string): PackageFileContent | null {
  // only process sections where requirements are defined
  const sections = content.split(regEx(/def |\n\[/)).filter(
    (part) =>
      part.includes('python_requires') || // only matches python_requires
      part.includes('[requires]') ||
      part.includes('[tool_requires]') ||
      part.includes('[test_requires]') ||
      part.includes('def build_requirements(self):') ||
      part.includes('def requirements(self):') ||
      part.includes('requires = ') ||
      part.includes('tool_requires = ') ||
      part.includes('test_requires = ') ||
      part.includes('python_requires = '),
  );

  const deps: PackageDependency[] = [];
  for (const section of sections) {
    let depType = setDepType(section, 'requires');
    const rawLines = section.split('\n').filter(is.nonEmptyString);

    for (const rawLine of rawLines) {
      if (!isComment(rawLine)) {
        depType = setDepType(rawLine, depType);
        // extract all dependencies from each line
        const lines = rawLine.split(regEx(/["'],/));
        for (const line of lines) {
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
      }
    }
  }

  return deps.length ? { deps } : null;
}
