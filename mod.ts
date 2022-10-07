import { Command } from 'cliffy/command/mod.ts';
import { prompt, Select } from 'cliffy/prompt/mod.ts';
import { colors } from 'cliffy/ansi/colors.ts';
import { config } from 'dotenv';
import type { ConfigOptions } from 'dotenv';

// Color message wrappers
export const error = colors.bold.red;
export const warn = colors.bold.yellow;
export const info = colors.bold.blue;

// Setup the environment variables config object that we will use in our various subcommands in this
// project and export it. Change the `baseEnvPath` variable to be the location of the .env and
// .env.example files that you are using for the `wk` binary (I keep the .env and .env.example files
// inside of the same folder as this git repository, so I've pointed the location to that folder on
// my machine)
export function getEnvConfig(overrideConfig?: ConfigOptions): ConfigOptions {
  const baseEnvPath = `${Deno.env.get('HOME')}/vincit/scripts/wk`;
  return {
    allowEmptyValues: false,
    example: `${baseEnvPath}/.env.example`,
    path: `${baseEnvPath}/.env`,
    safe: true,
    ...(overrideConfig ?? {}),
  };
}

// setup environment variable config to be the location of this script
const ENV = config(getEnvConfig());

// Get the Google Meet and Zoom link keys from the .env file
const MeetingLinks = Object.keys(ENV).reduce(
  (mtgs: Record<string, string>, mtg: string) => {
    const meeting = mtg.match(/^(?:MEET|ZOOM)_(.*)$/);
    if (meeting && meeting.length > 1) {
      return {
        ...mtgs,
        [meeting[1].toLowerCase()]: ENV[mtg],
      };
    } else {
      return mtgs;
    }
  },
  {},
);

// Create the main command
await new Command()
  // main command config
  .name('mtg')
  .version('0.1.0')
  .description(
    'Launch the desired meeting in the appropriate video call application or web browser',
  )
  .action(async () => {
    // If you're on linux, `xdg-open` will launch the URL in your default browser
    // If you're on MacOS, `open` will launch the URL in your default browser
    // If you're on Windows, then this program will exit early as Windows is not supported
    // You can also give the command-line program for the specific browser you want, (i.e.
    // `brave-browser`) to launch in a specific browser by supplying the BROWSER_CMD environment
    // variable inside of the .env file
    const currentOS = Deno.build.os;
    if (currentOS === 'windows') {
      console.log(
        error(
          'Windows is not supported or this script. Please use a Linux or Mac machine.',
        ),
      );
      Deno.exit();
    }
    const osCmds = {
      darwin: 'open',
      linux: 'xdg-open',
    };

    // Iterate through the Google Meet and Zoom URL env key lists to try and find a key that matches
    // the user's supplied meeting keyword. If we don't find one in any of the lists, then this will
    // be undefined

    const { mtg } = await prompt([{
      name: 'mtg',
      message: 'Choose a meeting to join',
      type: Select,
      search: true,
      options: Object.keys(MeetingLinks),
    }]);
    const meeting = mtg ? MeetingLinks[mtg] : undefined;

    // If no matching key was found, exit early and log out all the keywords that can be entered
    if (!meeting) {
      console.log(
        error(
          `Couldn\'t parse the Zoom url that you entered. Here are the valid options:\n${
            Object.keys(MeetingLinks)
              .sort()
              .join(', ')
          }`,
        ),
      );
      Deno.exit();
    } else if (meeting.includes('meet.google.com')) {
      // Handle Google Meet links
      // Make sure that the executable command supplied to the LAUNCH_VIDEO_CMD environment variable
      // is an executable before we try to execute it
      const launchVideoCmdIsExecutableStatus = await Deno.run({
        cmd: ['which', ENV.LAUNCH_VIDEO_CMD],
        stderr: 'null',
        stdout: 'null',
      }).status();

      // If it is executable, then use that command. Otherwise use the default `open` or `xdg-open`
      // command depending on our current OS to launch the URL. Build that process and run it
      await Deno.run({
        cmd: [
          launchVideoCmdIsExecutableStatus.success
            ? ENV.LAUNCH_VIDEO_CMD
            : osCmds[currentOS],
          MeetingLinks[mtg],
        ],
        stderr: 'null',
        stdout: 'null',
      }).status();
    } else {
      // Handle Zoom links
      // Make sure we have a valid zoom link, so that we can transform it to the zoommtg:// protocol
      // that the Zoom app uses. This allows us to avoid even bothering to launch the URL in a web
      // browser first
      const match = meeting.match(/zoom\.us\/j\/(\d+).+?pwd=(\w+)/);
      if (!match) {
        console.log(
          error(
            `The Zoom URL that we have saved for '${mtg}' is invalid. Please check the URL to make sure it is a valid Zoom URL and try again.`,
          ),
        );
        Deno.exit();
      }

      // Build the zoommtg:// protocol link to be launched
      const zoomLink = `zoommtg://zoom.us/join?action=join&confno=${
        match[1]
      }&pwd=${match[2]}`;

      // Build the process we are about to execute and run it with the appropriate OS command
      // (`open` for MacOS and `xdg-open` for Linux)
      await Deno.run({
        cmd: [osCmds[currentOS], zoomLink],
        stderr: 'null',
        stdout: 'null',
      }).status();
    }
  })
  // subcommands
  .parse(Deno.args);
