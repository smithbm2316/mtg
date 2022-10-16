import { Command } from 'cliffy/command/mod.ts';
import { Select } from 'cliffy/prompt/mod.ts';
import { colors } from 'cliffy/ansi/colors.ts';
import { config } from 'dotenv';
import type { ConfigOptions } from 'dotenv';

// These functions will allow us to add some color to different messages on the CLI. I'm setting up
// the `error` function to take a message like error('This is an error') and color it in bold and red
const error = colors.bold.red;
// we aren't using these for this particular script
// const warn = colors.bold.yellow;
// const info = colors.bold.blue;

/**
 * Sets up the initial dotenv configuration object
 * @param overrideConfig - config options that you want to override from the default
 * @returns a new dotenv config object
 */
export function getEnvConfig(overrideConfig?: ConfigOptions): ConfigOptions {
  // Make sure that you change this to be the path to where you `git clone`d this repo on your
  // system. the Deno.env.get('HOME') command will get your home folder for you, so from there
  // provide the rest of the path to the repository. It's currently set up below as if you cloned
  // the repo into your home folder in the ~/mtg folder. This is so that Deno knows where to find
  // the proper .env and .env.example files in this repo and you can execute the script from
  // anywhere on your system
  const baseEnvPath = `${Deno.env.get('HOME')}/mtg`;

  return {
    // don't allow this script to run properly if you
    allowEmptyValues: false,
    // the path to the example environment variable file
    example: `${baseEnvPath}/.env.defaults`,
    // the path to the _actual_ environment variable file
    path: `${baseEnvPath}/.env`,
    // if true, ensures that all the necessary environment variables scaffolded out in the
    // .env.example file are here. If they're not all supplied in the .env file, it exits early
    safe: true,
    // spread in any config overrides that we supply to this function
    ...(overrideConfig ?? {}),
  };
}

// setup environment variable config to be the location of this script
const ENV = await config(getEnvConfig());

// Get the Google Meet and Zoom link keys from the .env file
const MeetingLinks = Object.keys(ENV).reduce(
  (mtgs: Record<string, string>, mtg: string) => {
    // match links that start with "MEET" or "ZOOM", and capture the text after the prefix and
    // underscore. i.e. 'MEET_DAILY' will be a match and the value of 'DAILY' will be captured in
    // the second item (index of 1) in the RegexpArray returned
    const meeting = mtg.match(/^(?:MEET|ZOOM)_(.*)$/);
    if (meeting && meeting.length > 1) {
      // convert the current link name to lowercase and add it to our key/value pairs object
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

// Create the mtg command
await new Command()
  .name('mtg')
  .version('0.1.0')
  .description(
    'Launch the desired meeting in the appropriate video call application or web browser',
  )
  // here is the meat of this file. the `action` function is where we define the actual
  // Typescript/Javascript code for Deno to execute when we run this CLI program
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
    //
    const osCmds = {
      darwin: 'open',
      linux: 'xdg-open',
    };

    // Create a "prompt" UI component from Cliffy where we will supply the user with a list of
    // possible video calls they can select from by typing in the name or scrolling with up/down
    // arrow keys. the `prompt` UI function accepts an array of prompts, we can actually execute one
    // prompt after another in sequence if we want, for this we just execute one. from that, we
    // destructure the result that the user chose in the `mtg` variable
    const selectedMeetingName = await Select.prompt({
      message: 'Choose a meeting to join',
      search: true,
      options: Object.keys(MeetingLinks),
    });

    // Check to see if we have the proper URL for that link
    const meetingURL = selectedMeetingName
      ? MeetingLinks[selectedMeetingName]
      : undefined;

    // If no matching meeting link was found, exit early and log out all the meeting keywords that
    // are valid options
    if (!meetingURL) {
      console.log(
        error(
          `Couldn't find or parse the Zoom or Google Meet link that you entered. Here are the valid calls:\n${
            Object.keys(MeetingLinks)
              .sort()
              .join(', ')
          }`,
        ),
      );
      // exit the CLI program
      Deno.exit();
    } // Handle Google Meet links
    else if (meetingURL.includes('meet.google.com')) {
      // Make sure that the executable command supplied to the LAUNCH_VIDEO_CMD environment variable
      // is an executable before we try to execute it. the `which` command on your Mac/Linux machine
      // will check to see if the special command that you supplied is executable before we try to
      // execute with that (i.e. if you normally have Brave browser installed but don't right now
      // and tried to execute the `brave-browser` executable without it on your system)
      const launchVideoCmdIsExecutableStatus = ENV.LAUNCH_VIDEO_CMD
        ? await Deno.run({
          cmd: ['which', ENV.LAUNCH_VIDEO_CMD],
          // we don't want to see any extra output from `stderr` or `stdout` in our console
          stderr: 'null',
          stdout: 'null',
        }).status()
        // if that environment variable is empty then we don't even want to try to execute the
        // `which` command and just skip below to using the default Operating system command
        : { success: false };

      // If it is executable, then use that command. Otherwise use the default `open` or `xdg-open`
      // command depending on our current OS to launch the URL. Build that process and run it
      await Deno.run({
        cmd: [
          launchVideoCmdIsExecutableStatus.success
            ? ENV.LAUNCH_VIDEO_CMD
            : osCmds[currentOS],
          MeetingLinks[selectedMeetingName],
        ],
        // we don't want to see any extra output from `stderr` or `stdout` in our console
        stderr: 'null',
        stdout: 'null',
      }).status();
    } // Handle Zoom links
    else {
      // Make sure we have a valid zoom link, so that we can transform it to the zoommtg:// protocol
      // that the Zoom app uses. This allows us to avoid even bothering to launch the URL in a web
      // browser first
      const match = meetingURL.match(/zoom\.us\/j\/(\d+).+?pwd=(\w+)/);
      if (!match) {
        console.log(
          error(
            `The Zoom URL that we have saved for '${selectedMeetingName}' is invalid. Please check the URL to make sure it is a valid Zoom URL and try again.`,
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
        // we don't want to see any extra output from `stderr` or `stdout` in our console
        stderr: 'null',
        stdout: 'null',
      }).status();
    }
  })
  // subcommands
  .parse(Deno.args);
